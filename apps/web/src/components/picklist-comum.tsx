"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { PicklistSaldo, ReposicaoItem } from "@/lib/api";
import { browserApi } from "@/lib/api";
import { Cartao } from "@/components/ui/Cartao";
import { LinhaLista, Lista } from "@/components/ui/Lista";
import { formatInt } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase/browser";

/** Peças comuns à conferência do cupom e à carga manual. */

export async function token(): Promise<string> {
  const { data } = await supabaseBrowser().auth.getSession();
  if (!data.session) throw new Error("sessão expirada — entre de novo");
  return data.session.access_token;
}

export const num = (s: string) => Number(s.replace(",", "."));
export const valido = (s: string) => Number.isFinite(num(s)) && num(s) > 0;

export const CAMPO =
  "block h-11 w-full rounded-xl border border-campo-borda bg-campo px-3 text-base text-texto placeholder:text-terc disabled:opacity-60 md:text-[15px]";

/** Mensagem de erro da API: o 422 do Pydantic vem como lista. */
export function detalheDoErro(payload: { detail?: unknown }, status: number): string {
  const d = payload.detail;
  if (Array.isArray(d)) return d.map((x: { msg: string }) => x.msg).join("; ");
  return typeof d === "string" ? d : `backend respondeu ${status}`;
}

export function Aviso({ tom, children }: { tom: "laranja" | "vermelho" | "verde" | "cinza"; children: ReactNode }) {
  const cls = {
    laranja: "border-laranja-borda bg-laranja-fundo",
    vermelho: "border-vermelho-borda bg-vermelho-fundo",
    verde: "border-transparent bg-verde-fundo",
    cinza: "border-borda bg-vidro-fraco",
  }[tom];
  const simbolo = { laranja: "▲", vermelho: "■", verde: "●", cinza: null }[tom];
  const cor = { laranja: "text-laranja-texto", vermelho: "text-vermelho-texto", verde: "text-verde-texto", cinza: "" }[tom];
  return (
    <div className={`flex gap-2 rounded-2xl border px-4 py-3 text-[14px] text-texto ${cls}`}>
      {simbolo ? (
        <span aria-hidden="true" className={cor}>
          {simbolo}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** O que a linha do "Comprado sem estar na lista" diz sobre o saldo de antes da compra. */
function textoSaldo(s: PicklistSaldo | undefined): string {
  if (!s) return "sem saldo registrado nesta loja";
  const q = formatInt(s.quantidade);
  if (s.dias_restantes !== null) return `ainda tinha ${q} un., dava para ~${formatInt(s.dias_restantes)} dias`;
  // Sem venda no período a Reposição não pede nada — nem zerado.
  if (s.quantidade <= 0) return "estava zerado, mas sem venda nos últimos 30 dias";
  return `ainda tinha ${q} un.`;
}

/**
 * "Cupom × lista de Reposição": o que a lista da loja pedia e não veio, e o
 * que veio sem a lista pedir (com o saldo de antes, para dizer quanto havia).
 */
export function ConfrontoReposicao({
  org,
  localId,
  itens,
  rotulo,
}: {
  org: string;
  localId: string;
  /** Produtos que entram, já sem repetição e sem os ignorados. */
  itens: { product_id: string; nome: string }[];
  rotulo: "cupom" | "carga";
}) {
  const [reposicao, setReposicao] = useState<{ loja: string; itens: ReposicaoItem[] } | null>(null);
  const [saldos, setSaldos] = useState<{ loja: string; porProduto: Map<string, PicklistSaldo> } | null>(null);
  useEffect(() => {
    if (!localId) return;
    let vivo = true;
    (async () => {
      const t = await token();
      const [rResp, sResp] = await Promise.all([
        browserApi.request(`/orgs/${org}/stock/reposicao`, t),
        browserApi.request(`/orgs/${org}/picklist/saldos?loja=${localId}`, t),
      ]);
      if (rResp.ok) {
        const dados = (await rResp.json()) as { itens: ReposicaoItem[] };
        if (vivo) setReposicao({ loja: localId, itens: dados.itens.filter((i) => i.location_id === localId) });
      }
      // Sem o saldo o quadro ainda funciona — só não diz quanto havia.
      if (sResp.ok) {
        const dados = (await sResp.json()) as { itens: PicklistSaldo[] };
        if (vivo) setSaldos({ loja: localId, porProduto: new Map(dados.itens.map((i) => [i.product_id, i])) });
      }
    })().catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [org, localId]);

  const confronto = useMemo(() => {
    // Lista de outra loja (troca no meio da conferência) não vale para esta.
    if (!reposicao || reposicao.loja !== localId) return null;
    const entram = new Set(itens.map((i) => i.product_id));
    const naLista = new Set(reposicao.itens.map((i) => i.product_id));
    return {
      faltou: reposicao.itens.filter((i) => !entram.has(i.product_id)),
      fora: itens.filter((i) => !naLista.has(i.product_id)),
    };
  }, [reposicao, itens, localId]);
  const saldoDaLoja = saldos && saldos.loja === localId ? saldos.porProduto : null;

  if (!confronto) return null;
  const Nome = rotulo === "cupom" ? "Cupom" : "Carga";
  const no = rotulo === "cupom" ? "no cupom" : "na carga";
  return (
    <section aria-labelledby="cupom-x-lista" className="flex flex-col gap-3.5 md:gap-4">
      <h2 id="cupom-x-lista" className="m-0 mt-3 text-[20px] font-bold tracking-[-0.015em] text-texto">
        {Nome} × lista de Reposição
      </h2>
      <div className="grid gap-3.5 md:grid-cols-2 md:gap-4">
        <Cartao
          titulo={`Estava na lista e não veio · ${confronto.faltou.length}`}
          subtitulo={`A Reposição desta loja pedia estes itens, e eles não estão ${no}. Ficam para a próxima compra.`}
        >
          {confronto.faltou.length === 0 ? (
            <p className="m-0 text-[14px] text-sec">Tudo o que a lista pedia veio.</p>
          ) : (
            <Lista className="rounded-[14px]">
              {confronto.faltou.slice(0, 12).map((i) => (
                <LinhaLista
                  key={i.product_id}
                  esquerda={
                    i.status === "ruptura" ? (
                      <span className="text-vermelho-texto">
                        <span aria-hidden="true">■</span>
                        <span className="sr-only">Zerado:</span>
                      </span>
                    ) : (
                      <span className="text-laranja-texto">
                        <span aria-hidden="true">▲</span>
                        <span className="sr-only">Acabando:</span>
                      </span>
                    )
                  }
                  principal={i.produto}
                  secundario={
                    i.status === "ruptura"
                      ? `zerado · a lista pedia levar ${formatInt(i.sugestao)}`
                      : `restam ${formatInt(i.quantidade)} · a lista pedia levar ${formatInt(i.sugestao)}`
                  }
                />
              ))}
              {confronto.faltou.length > 12 ? (
                <LinhaLista href="/reposicao" principal={`e mais ${confronto.faltou.length - 12} na Reposição`} />
              ) : null}
            </Lista>
          )}
        </Cartao>
        <Cartao
          titulo={`Comprado sem estar na lista · ${confronto.fora.length}`}
          subtitulo={`Veio ${no}, mas ainda havia saldo para mais de 5 dias. Não é erro — só confira se não está comprando antes da hora.`}
        >
          {confronto.fora.length === 0 ? (
            <p className="m-0 text-[14px] text-sec">Nada além do que a lista pedia.</p>
          ) : (
            <Lista className="rounded-[14px]">
              {confronto.fora.map((l) => (
                <LinhaLista
                  key={l.product_id}
                  principal={l.nome}
                  secundario={saldoDaLoja ? textoSaldo(saldoDaLoja.get(l.product_id)) : undefined}
                />
              ))}
            </Lista>
          )}
        </Cartao>
      </div>
    </section>
  );
}
