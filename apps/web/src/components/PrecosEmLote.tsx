"use client";

import { useState } from "react";
import type { PreviaPrecos } from "@/lib/api";
import { browserApi } from "@/lib/api";
import { ExportCsvButton } from "@/components/ExportCsvButton";
import { Botao } from "@/components/ui/Botao";
import { Folha, RodapeFolha } from "@/components/ui/Folha";
import { Selo } from "@/components/ui/Selo";
import { formatInt, formatMoney } from "@/lib/format";
import { lerTextoDoArquivo } from "@/lib/planilha";
import { supabaseBrowser } from "@/lib/supabase/browser";

async function token(): Promise<string> {
  const { data } = await supabaseBrowser().auth.getSession();
  if (!data.session) throw new Error("sessão expirada — entre de novo");
  return data.session.access_token;
}

/**
 * Preço em lote: baixa a planilha da loja, preenche `preco_novo` só onde muda,
 * sobe de volta, confere a prévia e aplica. Nada vai para a VMpay antes do
 * "Aplicar" — e o servidor reconfere tudo no clique.
 */
export function PrecosEmLote({
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
  const [previa, setPrevia] = useState<PreviaPrecos | null>(null);
  const [arquivo, setArquivo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<"lendo" | "aplicando" | null>(null);

  async function chamar(path: string, body: unknown) {
    const resp = await browserApi.request(`/orgs/${org}/stock/precos/${path}`, await token(), {
      method: "POST",
      body: JSON.stringify(body),
    });
    const payload = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(payload.detail ?? `backend respondeu ${resp.status}`);
    return payload;
  }

  async function escolher(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = ""; // permite subir o mesmo arquivo de novo depois de corrigir
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
        itens: previa.alterar.map((a) => ({ product_id: a.product_id, preco: a.preco_novo })),
      });
      onAplicado(
        r.status === "sem_mudancas"
          ? "Nada a aplicar: os preços já estavam assim na VMpay."
          : `${formatInt(r.aplicados)} preço(s) atualizados na VMpay em ${loja}.`,
      );
    } catch (err) {
      setErro(err instanceof Error ? err.message : "falha ao aplicar");
      setOcupado(null);
    }
  }

  const r = previa?.resumo;

  return (
    <Folha titulo="Atualizar preços por planilha" subtitulo={loja} onFechar={onFechar} largura="md:max-w-[760px]">
      <ol className="m-0 flex list-none flex-col gap-3 p-0 text-[15px] text-texto">
        <li className="flex flex-wrap items-center justify-between gap-3">
          <span>
            <strong>1.</strong> Baixe a planilha desta loja.
          </span>
          <ExportCsvButton
            path={`/orgs/${org}/stock/precos/planilha.csv?location_id=${locationId}`}
            filename="precos.csv"
            rotulo="Baixar planilha"
            tamanho="p"
          />
        </li>
        <li>
          <strong>2.</strong> Preencha a coluna <code>preco_novo</code> só nos produtos que mudam. Linha em
          branco ou apagada fica como está. Não mexa na coluna <code>id</code>.
        </li>
        <li className="flex flex-wrap items-center justify-between gap-3">
          <span>
            <strong>3.</strong> Suba a planilha preenchida.
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
            <Selo tom={r.alterar > 0 ? "azul" : "cinza"}>{formatInt(r.alterar)} vão mudar</Selo>
            <Selo>{formatInt(r.iguais)} já com esse preço</Selo>
            <Selo>{formatInt(r.em_branco)} em branco</Selo>
            {r.erros > 0 ? <Selo tom="vermelho">{formatInt(r.erros)} com erro</Selo> : null}
          </div>

          {previa.alterar.length > 0 ? (
            <div className="mt-3 max-h-[40dvh] overflow-y-auto rounded-[14px] bg-lista">
              <table className="w-full border-collapse text-[14px]">
                <thead>
                  <tr className="text-left text-[12px] font-semibold uppercase tracking-[0.03em] text-sec">
                    <th scope="col" className="px-3 py-2 font-semibold">Produto</th>
                    <th scope="col" className="w-[90px] px-3 py-2 text-right font-semibold">Hoje</th>
                    <th scope="col" className="w-[90px] px-3 py-2 text-right font-semibold">Novo</th>
                  </tr>
                </thead>
                <tbody>
                  {previa.alterar.map((a) => (
                    <tr key={a.product_id} className="border-t border-sep align-top">
                      <td className="px-3 py-2 text-texto">
                        {a.produto}
                        {a.avisos.map((aviso) => (
                          <span key={aviso} className="block text-[13px] text-laranja-texto">
                            ▲ {aviso}
                          </span>
                        ))}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-sec">
                        {a.preco_atual !== null ? formatMoney(a.preco_atual) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-texto">
                        {formatMoney(a.preco_novo)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {previa.erros.length > 0 ? (
            <div className="mt-3 text-[14px]">
              <p className="m-0 text-sec">
                Linhas com erro ficam de fora — corrija na planilha e suba de novo, ou aplique só o resto:
              </p>
              <ul className="mt-1.5 max-h-[20dvh] list-none overflow-y-auto p-0">
                {previa.erros.map((e) => (
                  <li key={e.linha} className="py-0.5 text-vermelho-texto">
                    ■ Linha {e.linha}
                    {e.produto ? ` (${e.produto})` : ""}: {e.motivo}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {!previa.escrita_liberada && previa.alterar.length > 0 ? (
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
          disabled={!previa || previa.alterar.length === 0 || !previa.escrita_liberada || ocupado !== null}
        >
          {ocupado === "aplicando"
            ? "Aplicando…"
            : previa && previa.alterar.length > 0
              ? `Aplicar ${formatInt(previa.alterar.length)} preço(s)`
              : "Aplicar"}
        </Botao>
      </RodapeFolha>
    </Folha>
  );
}
