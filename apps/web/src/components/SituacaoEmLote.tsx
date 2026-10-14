"use client";

import { useState } from "react";
import { browserApi } from "@/lib/api";
import { ExportCsvButton } from "@/components/ExportCsvButton";
import { Botao } from "@/components/ui/Botao";
import { Folha, RodapeFolha } from "@/components/ui/Folha";
import { Selo } from "@/components/ui/Selo";
import { formatInt } from "@/lib/format";
import { lerTextoDoArquivo } from "@/lib/planilha";
import { supabaseBrowser } from "@/lib/supabase/browser";

async function token(): Promise<string> {
  const { data } = await supabaseBrowser().auth.getSession();
  if (!data.session) throw new Error("sessão expirada — entre de novo");
  return data.session.access_token;
}

type Situacao = "active" | "suspended" | "inactive";

export const NOME_SITUACAO: Record<Situacao, string> = { active: "ativo", suspended: "suspenso", inactive: "inativo" };

type Previa = {
  mudar: { linha: number; product_id: string; produto: string; de: Situacao; para: Situacao; saldo: number; avisos: string[] }[];
  erros: { linha: number; produto: string | null; motivo: string }[];
  resumo: { mudar: number; iguais: number; em_branco: number; erros: number };
  escrita_liberada: boolean;
};

/**
 * Tirar de linha (ou reativar) em lote. A VMpay não apaga item de
 * planograma: suspenso vende o que sobrou e não se repõe; inativo para de
 * vender na hora. Os dois saem da Reposição e da contagem de zerados.
 */
export function SituacaoEmLote({
  org,
  locationId,
  loja,
  onFechar,
  onAplicado,
}: {
  org: string;
  locationId: string;
  loja: string;
  onFechar: () => void;
  onAplicado: (mensagem: string) => void;
}) {
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [arquivo, setArquivo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<"lendo" | "aplicando" | null>(null);

  async function chamar(path: string, body: unknown) {
    const resp = await browserApi.request(`/orgs/${org}/stock/situacao/${path}`, await token(), {
      method: "POST",
      body: JSON.stringify(body),
    });
    const payload = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(payload.detail ?? `backend respondeu ${resp.status}`);
    return payload;
  }

  async function escolher(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setErro(null);
    setPrevia(null);
    setArquivo(f.name);
    setOcupado("lendo");
    try {
      setPrevia(await chamar("previa", { location_id: locationId, conteudo: await lerTextoDoArquivo(f) }));
    } catch (err) {
      setErro(err instanceof Error ? err.message : "falha ao ler a planilha");
    } finally {
      setOcupado(null);
    }
  }

  async function aplicar() {
    if (!previa) return;
    setErro(null);
    setOcupado("aplicando");
    try {
      const r = await chamar("aplicar", {
        location_id: locationId,
        itens: previa.mudar.map((m) => ({ product_id: m.product_id, situacao: m.para })),
      });
      onAplicado(
        r.status === "sem_mudancas"
          ? "Nada a mudar: as situações já estavam assim na VMpay."
          : `${formatInt(r.alterados)} produto(s) com a situação alterada em ${loja}.`,
      );
    } catch (err) {
      setErro(err instanceof Error ? err.message : "falha ao aplicar");
      setOcupado(null);
    }
  }

  const r = previa?.resumo;

  return (
    <Folha titulo="Tirar de linha ou reativar" subtitulo={loja} onFechar={onFechar} largura="md:max-w-[720px]">
      <ol className="m-0 flex list-none flex-col gap-3 p-0 text-[15px] text-texto">
        <li className="flex flex-wrap items-center justify-between gap-3">
          <span>
            <strong>1.</strong> Baixe a planilha da loja, com a situação atual de cada produto.
          </span>
          <ExportCsvButton
            path={`/orgs/${org}/stock/situacao/modelo.csv?location_id=${locationId}`}
            filename="situacao.csv"
            rotulo="Baixar planilha"
            tamanho="p"
          />
        </li>
        <li>
          <strong>2.</strong> Em <code>nova_situacao</code>, escreva só onde muda: <strong>suspenso</strong> (vende o que
          sobrou, não repõe), <strong>inativo</strong> (para de vender já) ou <strong>ativo</strong> (volta à linha).
        </li>
        <li className="flex flex-wrap items-center justify-between gap-3">
          <span>
            <strong>3.</strong> Suba a planilha.
            {arquivo ? <span className="block text-[13px] text-sec">{arquivo}</span> : null}
          </span>
          <label className="inline-flex h-11 cursor-pointer items-center rounded-full bg-azul-tinta px-4 text-[14px] font-medium text-azul-texto hover:brightness-95 md:h-[34px] md:px-3.5">
            {ocupado === "lendo" ? "Conferindo…" : arquivo ? "Trocar arquivo" : "Escolher arquivo"}
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={escolher} disabled={ocupado !== null} />
          </label>
        </li>
      </ol>

      {previa && r ? (
        <div className="mt-5">
          <div className="flex flex-wrap gap-2">
            <Selo tom={r.mudar > 0 ? "azul" : "cinza"}>{formatInt(r.mudar)} vão mudar</Selo>
            <Selo>{formatInt(r.iguais)} já assim</Selo>
            <Selo>{formatInt(r.em_branco)} em branco</Selo>
            {r.erros > 0 ? <Selo tom="vermelho">{formatInt(r.erros)} com erro</Selo> : null}
          </div>
          {previa.mudar.length > 0 ? (
            <ul className="m-0 mt-3 max-h-[40dvh] list-none overflow-y-auto rounded-[14px] bg-lista p-0 text-[14px]">
              {previa.mudar.map((m) => (
                <li key={m.product_id} className="border-t border-sep px-3 py-2 first:border-t-0">
                  <span className="text-texto">{m.produto}</span>
                  <span className="ml-2 text-sec">
                    {NOME_SITUACAO[m.de]} → <strong className="text-texto">{NOME_SITUACAO[m.para]}</strong>
                  </span>
                  {m.avisos.map((a) => (
                    <span key={a} className="block text-[13px] text-laranja-texto">
                      ▲ {a}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          ) : null}
          {previa.erros.length > 0 ? (
            <ul className="mt-3 max-h-[20dvh] list-none overflow-y-auto p-0 text-[14px]">
              {previa.erros.map((e) => (
                <li key={e.linha} className="py-0.5 text-vermelho-texto">
                  ■ Linha {e.linha}
                  {e.produto ? ` (${e.produto})` : ""}: {e.motivo}
                </li>
              ))}
            </ul>
          ) : null}
          {!previa.escrita_liberada && previa.mudar.length > 0 ? (
            <p className="mt-3 text-[14px] text-laranja-texto">
              ▲ A escrita na VMpay está travada neste ambiente — a conferência funciona, aplicar não.
            </p>
          ) : null}
        </div>
      ) : null}

      {erro ? (
        <p role="alert" className="mt-3 text-[14px] text-vermelho-texto">
          ■ {erro}
        </p>
      ) : null}

      <RodapeFolha>
        <Botao variante="tingido" tamanho="g" onClick={onFechar}>
          Cancelar
        </Botao>
        <Botao
          variante="cheio"
          tamanho="g"
          onClick={aplicar}
          disabled={!previa || previa.mudar.length === 0 || !previa.escrita_liberada || ocupado !== null}
        >
          {ocupado === "aplicando"
            ? "Aplicando…"
            : previa && previa.mudar.length > 0
              ? `Aplicar ${formatInt(previa.mudar.length)} mudança(s)`
              : "Aplicar"}
        </Botao>
      </RodapeFolha>
    </Folha>
  );
}
