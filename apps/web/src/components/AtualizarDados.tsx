"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { browserApi } from "@/lib/api";
import { formatAtraso } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase/browser";

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

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={atualizar}
        disabled={ocupado}
        title={`Busca agora as vendas e o estoque na VMpay. Atualização ${situacao?.automatica ?? "automática a cada hora"}.`}
        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-[var(--grid)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--row-hover)] disabled:opacity-60"
      >
        <svg
          aria-hidden
          viewBox="0 0 16 16"
          className={`h-3.5 w-3.5 ${ocupado ? "animate-spin" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
          <path d="M13.5 2.5v3h-3" />
        </svg>
        {ocupado ? (
          "Atualizando…"
        ) : (
          <>
            <span className="sm:hidden">Atualizar</span>
            <span className="hidden sm:inline">Atualizar dados do sistema</span>
          </>
        )}
      </button>
      <span
        role="status"
        // Aviso (erro, "aguarde 90s") aparece em qualquer tela; o "há X min"
        // só onde cabe ao lado do botão — no celular o title do botão explica.
        className={`text-[11px] leading-tight ${aviso ? "block max-w-48" : "hidden lg:block"} ${
          velho || aviso?.alerta ? "text-[var(--status-warning)]" : "text-[var(--text-secondary)]"
        }`}
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
    </div>
  );
}
