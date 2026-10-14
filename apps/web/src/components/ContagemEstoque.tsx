"use client";

import { useState } from "react";
import { browserApi } from "@/lib/api";
import { ExportCsvButton } from "@/components/ExportCsvButton";
import { Botao } from "@/components/ui/Botao";
import { CAMPO, Folha, ROTULO_CAMPO, RodapeFolha } from "@/components/ui/Folha";
import { Selo } from "@/components/ui/Selo";
import { formatInt } from "@/lib/format";
import { lerTextoDoArquivo } from "@/lib/planilha";
import { supabaseBrowser } from "@/lib/supabase/browser";

async function token(): Promise<string> {
  const { data } = await supabaseBrowser().auth.getSession();
  if (!data.session) throw new Error("sessão expirada — entre de novo");
  return data.session.access_token;
}

type Previa = {
  contado_em: string;
  diferencas: {
    linha: number;
    product_id: string;
    produto: string;
    sistema: number;
    contado: number;
    diferenca: number;
    vendidas_desde: number;
    avisos: string[];
  }[];
  erros: { linha: number; produto: string | null; motivo: string }[];
  resumo: { diferencas: number; conferem: number; nao_contados: number; erros: number; faltam: number; sobram: number };
  vendas_atualizadas: boolean;
  escrita_liberada: boolean;
};

/** "2026-10-14T11:30" no fuso do navegador — o valor que o <input type=datetime-local> entende. */
function agoraLocal(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

const qtd = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

/**
 * Contagem de estoque: o operador conta a loja, sobe a planilha e o saldo
 * da VMpay vira o contado. A diferença fica registrada como perda ou sobra.
 * Linha em branco é produto não contado — não vira zero.
 */
export function ContagemEstoque({
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
  const [contadoEm, setContadoEm] = useState(agoraLocal);
  const [conteudo, setConteudo] = useState<string | null>(null);
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [arquivo, setArquivo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<"lendo" | "aplicando" | null>(null);

  async function chamar(path: string, body: unknown) {
    const resp = await browserApi.request(`/orgs/${org}/stock/contagem/${path}`, await token(), {
      method: "POST",
      body: JSON.stringify(body),
    });
    const payload = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(payload.detail ?? `backend respondeu ${resp.status}`);
    return payload;
  }

  const contadoEmIso = () => new Date(contadoEm).toISOString();

  async function conferir(texto: string) {
    setErro(null);
    setPrevia(null);
    setOcupado("lendo");
    try {
      setPrevia(await chamar("previa", { location_id: locationId, conteudo: texto, contado_em: contadoEmIso() }));
    } catch (err) {
      setErro(err instanceof Error ? err.message : "falha ao ler a planilha");
    } finally {
      setOcupado(null);
    }
  }

  async function escolher(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setArquivo(f.name);
    const texto = await lerTextoDoArquivo(f);
    setConteudo(texto);
    await conferir(texto);
  }

  async function aplicar() {
    if (!previa) return;
    setErro(null);
    setOcupado("aplicando");
    try {
      const r = await chamar("aplicar", {
        location_id: locationId,
        contado_em: contadoEmIso(),
        itens: previa.diferencas.map((d) => ({ product_id: d.product_id, contado: d.contado })),
      });
      onAplicado(
        r.status === "sem_mudancas"
          ? "Nada a ajustar: os saldos já batiam com a contagem."
          : `Contagem aplicada em ${loja}: ${formatInt(r.ajustados)} saldo(s) ajustados — faltaram ${qtd(r.faltam)} un., sobraram ${qtd(r.sobram)} un.`,
      );
    } catch (err) {
      setErro(err instanceof Error ? err.message : "falha ao aplicar");
      setOcupado(null);
    }
  }

  const r = previa?.resumo;

  return (
    <Folha titulo="Contagem de estoque" subtitulo={loja} onFechar={onFechar} largura="md:max-w-[780px]">
      <ol className="m-0 flex list-none flex-col gap-3 p-0 text-[15px] text-texto">
        <li className="flex flex-wrap items-center justify-between gap-3">
          <span>
            <strong>1.</strong> Baixe a planilha da loja e conte.
          </span>
          <ExportCsvButton
            path={`/orgs/${org}/stock/contagem/modelo.csv?location_id=${locationId}`}
            filename="contagem.csv"
            rotulo="Baixar planilha"
            tamanho="p"
          />
        </li>
        <li>
          <strong>2.</strong> Anote em <code>contado</code> o que achou de cada produto (0 se não achou nenhum). Produto
          que você não contou: deixe em branco — ele não muda.
        </li>
        <li className="flex flex-wrap items-end justify-between gap-3">
          <label className={`${ROTULO_CAMPO} min-w-[220px]`}>
            <strong className="text-[15px] text-texto">3.</strong> Quando terminou de contar
            <input
              type="datetime-local"
              value={contadoEm}
              max={agoraLocal()}
              onChange={(e) => {
                setContadoEm(e.target.value);
                setPrevia(null);
              }}
              className={CAMPO}
            />
          </label>
          <span className="flex items-center gap-2">
            {arquivo ? <span className="text-[13px] text-sec">{arquivo}</span> : null}
            {conteudo && !previa && !ocupado ? (
              <Botao tamanho="p" onClick={() => conferir(conteudo)}>
                Conferir de novo
              </Botao>
            ) : null}
            <label className="inline-flex h-11 cursor-pointer items-center rounded-full bg-azul-tinta px-4 text-[14px] font-medium text-azul-texto hover:brightness-95 md:h-[34px] md:px-3.5">
              {ocupado === "lendo" ? "Conferindo…" : arquivo ? "Trocar arquivo" : "Subir planilha"}
              <input type="file" accept=".csv,text/csv" className="sr-only" onChange={escolher} disabled={ocupado !== null} />
            </label>
          </span>
        </li>
      </ol>
      <p className="m-0 mt-2 text-[13px] text-sec">
        O que a loja vendeu depois desse horário é descontado — não vira perda.
      </p>

      {previa && r ? (
        <div className="mt-5">
          <div className="flex flex-wrap gap-2">
            {r.faltam > 0 ? <Selo tom="vermelho">faltam {qtd(r.faltam)} un.</Selo> : null}
            {r.sobram > 0 ? <Selo tom="laranja">sobram {qtd(r.sobram)} un.</Selo> : null}
            <Selo tom="verde">{formatInt(r.conferem)} conferem</Selo>
            <Selo>{formatInt(r.nao_contados)} não contados</Selo>
            {r.erros > 0 ? <Selo tom="vermelho">{formatInt(r.erros)} com erro</Selo> : null}
          </div>

          {!previa.vendas_atualizadas ? (
            <p className="m-0 mt-2 text-[14px] text-laranja-texto">
              ▲ A VMpay não deu as vendas dos últimos minutos — venda recente pode aparecer como sobra. Aplicar só
              funciona com elas em dia.
            </p>
          ) : null}

          {previa.diferencas.length > 0 ? (
            <div className="mt-3 max-h-[40dvh] overflow-y-auto rounded-[14px] bg-lista">
              <table className="w-full border-collapse text-[14px]">
                <thead>
                  <tr className="text-left text-[12px] font-semibold uppercase tracking-[0.03em] text-sec">
                    <th scope="col" className="px-3 py-2 font-semibold">Produto</th>
                    <th scope="col" className="w-[80px] px-3 py-2 text-right font-semibold">Sistema</th>
                    <th scope="col" className="w-[80px] px-3 py-2 text-right font-semibold">Contado</th>
                    <th scope="col" className="w-[90px] px-3 py-2 text-right font-semibold">Diferença</th>
                  </tr>
                </thead>
                <tbody>
                  {previa.diferencas.map((d) => (
                    <tr key={d.product_id} className="border-t border-sep align-top">
                      <td className="px-3 py-2 text-texto">
                        {d.produto}
                        {d.vendidas_desde > 0 ? (
                          <span className="block text-[13px] text-sec">vendeu {qtd(d.vendidas_desde)} depois da contagem</span>
                        ) : null}
                        {d.avisos.map((a) => (
                          <span key={a} className="block text-[13px] text-laranja-texto">
                            ▲ {a}
                          </span>
                        ))}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-sec">{qtd(d.sistema)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-texto">{qtd(d.contado)}</td>
                      <td
                        className={`px-3 py-2 text-right font-semibold tabular-nums ${d.diferenca < 0 ? "text-vermelho-texto" : "text-laranja-texto"}`}
                      >
                        {d.diferenca > 0 ? "+" : ""}
                        {qtd(d.diferenca)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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

          {!previa.escrita_liberada && previa.diferencas.length > 0 ? (
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
          disabled={!previa || previa.diferencas.length === 0 || !previa.escrita_liberada || ocupado !== null}
        >
          {ocupado === "aplicando"
            ? "Aplicando…"
            : previa && previa.diferencas.length > 0
              ? `Ajustar ${formatInt(previa.diferencas.length)} saldo(s)`
              : "Ajustar saldos"}
        </Botao>
      </RodapeFolha>
    </Folha>
  );
}
