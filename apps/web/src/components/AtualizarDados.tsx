"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { browserApi } from "@/lib/api";
import { formatAtraso } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { IconeAtualizar } from "@/components/ui/icones";

type Situacao = {
  rodando: boolean;
  ultima_conclusao: string | null;
  dados_de: string | null;
  automatica: string;
};

/** A rodada de produção leva de segundos a alguns minutos (o catálogo é grande). */
const ESPERA_MAX_MS = 5 * 60 * 1000;
const INTERVALO_MS = 4000;

async function token(): Promise<string> {
  const { data } = await supabaseBrowser().auth.getSession();
  if (!data.session) throw new Error("sessão expirada — entre de novo");
  return data.session.access_token;
}

/**
 * "Atualizar dados" da barra: pede à API uma rodada de ingestão agora (vendas
 * + estoque) em vez de esperar o cron, e recarrega a página quando ela acaba.
 */
export function AtualizarDados({ org }: { org: string }) {
  const router = useRouter();
  const [situacao, setSituacao] = useState<Situacao | null>(null);
  const [atualizando, setAtualizando] = useState(false);
  const [aviso, setAviso] = useState<{ texto: string; alerta: boolean } | null>(null);
  // Relógio para o "há X min" andar sem recarregar; atualiza a cada 30s.
  const [agora, setAgora] = useState(() => Date.now());

  const buscar = useCallback(async (): Promise<Situacao | null> => {
    const resp = await browserApi.request(`/orgs/${org}/sync`, await token());
    return resp.ok ? ((await resp.json()) as Situacao) : null;
  }, [org]);

  useEffect(() => {
    let vivo = true;
    buscar()
      .then((s) => {
        if (vivo && s) setSituacao(s);
      })
      .catch(() => undefined);
    const t = setInterval(() => setAgora(Date.now()), 30_000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [buscar]);

  async function atualizar() {
    setAtualizando(true);
    setAviso(null);
    try {
      const resp = await browserApi.request(`/orgs/${org}/sync`, await token(), { method: "POST" });
      const payload = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(payload.detail ?? `backend respondeu ${resp.status}`);

      const pedidoEm = Date.parse(payload.pedido_em ?? new Date().toISOString()) - 2000;
      const limite = Date.now() + ESPERA_MAX_MS;
      while (Date.now() < limite) {
        await new Promise((r) => setTimeout(r, INTERVALO_MS));
        const s = await buscar();
        if (s) setSituacao(s);
        const concluida = s?.ultima_conclusao ? Date.parse(s.ultima_conclusao) : 0;
        if (s && !s.rodando && concluida >= pedidoEm) {
          setAgora(Date.now());
          router.refresh();
          setAviso({ texto: "Dados atualizados.", alerta: false });
          return;
        }
      }
      setAviso({ texto: "Está demorando — os dados aparecem quando terminar.", alerta: true });
    } catch (err) {
      setAviso({ texto: err instanceof Error ? err.message : "falha ao atualizar", alerta: true });
    } finally {
      setAtualizando(false);
    }
  }

  const idadeSeg = situacao?.dados_de
    ? Math.max(0, Math.floor((agora - Date.parse(situacao.dados_de)) / 1000))
    : null;
  // Mais de 6h sem dado novo já é mais que o atraso normal do agendador.
  const velho = idadeSeg !== null && idadeSeg > 6 * 3600;
  const ocupado = atualizando || situacao?.rodando === true;

  // Uma instância só nos dois tamanhos (o GET de situação não dobra): no
  // celular, botão redondo só com ícone no topo compacto; de md para cima, a
  // pílula "Atualizar" da barra, com o "há X min" ao lado em telas largas.
  return (
    <div className="relative flex items-center gap-2.5">
      <span
        role="status"
        // Aviso (erro, "aguarde 90s") aparece em qualquer tela — no celular
        // num balão sob o botão, porque o topo não tem espaço; o "há X min"
        // só onde cabe ao lado do botão (lg+). No celular o title explica.
        className={
          aviso
            ? `vidro-forte absolute right-0 top-full z-30 mt-2 w-64 rounded-2xl px-3.5 py-2.5 text-[13px] lg:static lg:mt-0 lg:w-auto lg:max-w-48 lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:text-right lg:text-xs lg:shadow-none lg:backdrop-blur-none ${
                aviso.alerta ? "text-laranja-texto" : "text-texto"
              }`
            : // A proposta não tem o "há X min" na barra, e com ele a barra
              // quebra em duas linhas mesmo a 1440px. Fica no title do botão
              // (e para leitor de tela); só aparece quando o dado está velho.
              velho
              ? "hidden text-right text-xs leading-tight text-laranja-texto lg:block"
              : "sr-only"
        }
      >
        {aviso?.texto ??
          (idadeSeg !== null ? (
            <>
              {velho ? "▲ " : ""}atualizado {formatAtraso(idadeSeg)}
              <br />
              {situacao?.automatica}
            </>
          ) : null)}
      </span>
      <button
        type="button"
        onClick={atualizar}
        disabled={ocupado}
        title={`${idadeSeg !== null ? `Dados atualizados ${formatAtraso(idadeSeg)}. ` : ""}Busca agora as vendas e o estoque na VMpay. Atualização ${situacao?.automatica ?? "automática a cada hora"}.`}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border-0 bg-azul-tinta text-[14px] font-medium text-azul-texto hover:brightness-95 disabled:opacity-60 md:h-9 md:w-auto md:px-3.5"
      >
        <IconeAtualizar tamanho={16} className={ocupado ? "motion-safe:animate-spin" : ""} />
        <span className="sr-only md:not-sr-only">{ocupado ? "Atualizando…" : "Atualizar"}</span>
      </button>
    </div>
  );
}
