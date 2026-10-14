"use client";

import { useState } from "react";
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

type Ref = { id: number; nome: string };

type ItemPrevia = {
  linha: number;
  acao: "criar" | "incluir";
  nome: string;
  codigo_barras: string | null;
  product_id: string | null;
  preco: number;
  capacidade: number;
  nivel_ideal: number;
  nivel_alerta: number;
  fabricante?: Ref;
  categoria?: Ref;
  categoria_abastecimento?: Ref;
  avisos: string[];
};

type Previa = {
  loja: string;
  padroes: { capacidade: number; nivel_ideal: number; nivel_alerta: number };
  itens: ItemPrevia[];
  erros: { linha: number; nome: string | null; motivo: string }[];
  resumo: { criar: number; incluir: number; erros: number };
  escrita_liberada: boolean;
};

type Resultado = {
  erro_prateleira: string | null;
  linhas: { linha: number; status: "criado" | "ja_cadastrado" | "erro"; motivo?: string; prateleira?: string }[];
  resumo: { criados: number; na_prateleira: number; erros: number };
};

/**
 * Cadastro em lote: a planilha cria os produtos na VMpay e já os põe na
 * prateleira da loja, com preço e níveis. A VMpay cria um produto por vez,
 * então o resultado é por linha — e subir a mesma planilha de novo só
 * completa o que faltou (a prévia reconhece pelo código de barras).
 */
export function CadastroEmLote({
  org,
  locationId,
  loja,
  onFechar,
  onConcluido,
}: {
  org: string;
  locationId: string;
  loja: string;
  onFechar: () => void;
  onConcluido: (mensagem: string) => void;
}) {
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [arquivo, setArquivo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<"lendo" | "aplicando" | null>(null);

  async function chamar(path: string, body: unknown) {
    const resp = await browserApi.request(`/orgs/${org}/products/lote/${path}`, await token(), {
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
    setResultado(null);
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
      const r = (await chamar("aplicar", { location_id: locationId, itens: previa.itens })) as Resultado;
      if (r.resumo.erros === 0 && !r.erro_prateleira) {
        onConcluido(
          `${formatInt(r.resumo.criados)} produto(s) cadastrados e ${formatInt(r.resumo.na_prateleira)} incluídos na prateleira de ${loja}. Eles aparecem zerados, prontos para a carga.`,
        );
        return;
      }
      setResultado(r);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "falha ao cadastrar");
    } finally {
      setOcupado(null);
    }
  }

  const r = previa?.resumo;
  const total = previa ? previa.itens.length : 0;
  const nomes = new Map(previa?.itens.map((i) => [i.linha, i.nome]) ?? []);

  return (
    <Folha titulo="Cadastrar produtos por planilha" subtitulo={loja} onFechar={onFechar} largura="md:max-w-[820px]">
      <ol className="m-0 flex list-none flex-col gap-3 p-0 text-[15px] text-texto">
        <li className="flex flex-wrap items-center justify-between gap-3">
          <span>
            <strong>1.</strong> Baixe o modelo e a lista de fabricantes e categorias desta conta.
          </span>
          <span className="flex gap-2">
            <ExportCsvButton path={`/orgs/${org}/products/lote/modelo.csv`} filename="cadastro.csv" rotulo="Modelo" tamanho="p" />
            <ExportCsvButton
              path={`/orgs/${org}/products/lote/referencias.csv?location_id=${locationId}`}
              filename="referencias.csv"
              rotulo="Fabricantes e categorias"
              tamanho="p"
              variante="texto"
            />
          </span>
        </li>
        <li>
          <strong>2.</strong> Uma linha por produto. Fabricante e categorias com o nome exato da lista. Capacidade e
          níveis em branco usam o padrão desta loja.
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

      {previa && r && !resultado ? (
        <div className="mt-5">
          <div className="flex flex-wrap gap-2">
            <Selo tom={r.criar > 0 ? "azul" : "cinza"}>{formatInt(r.criar)} novos</Selo>
            <Selo>{formatInt(r.incluir)} já cadastrados → só prateleira</Selo>
            {r.erros > 0 ? <Selo tom="vermelho">{formatInt(r.erros)} com erro</Selo> : null}
          </div>
          <p className="m-0 mt-2 text-[13px] text-sec">
            Padrão desta loja para níveis em branco: capacidade {previa.padroes.capacidade}, ideal{" "}
            {previa.padroes.nivel_ideal}, alerta {previa.padroes.nivel_alerta}.
          </p>

          {previa.itens.length > 0 ? (
            <div className="mt-3 max-h-[38dvh] overflow-y-auto rounded-[14px] bg-lista">
              <table className="w-full border-collapse text-[14px]">
                <thead>
                  <tr className="text-left text-[12px] font-semibold uppercase tracking-[0.03em] text-sec">
                    <th scope="col" className="px-3 py-2 font-semibold">Produto</th>
                    <th scope="col" className="w-[90px] px-3 py-2 text-right font-semibold">Preço</th>
                    <th scope="col" className="w-[120px] px-3 py-2 text-right font-semibold">Cap./ideal/alerta</th>
                  </tr>
                </thead>
                <tbody>
                  {previa.itens.map((i) => (
                    <tr key={i.linha} className="border-t border-sep align-top">
                      <td className="px-3 py-2 text-texto">
                        {i.nome}
                        <span className="block text-[13px] text-sec">
                          {i.acao === "criar"
                            ? `${i.fabricante?.nome} · ${i.categoria?.nome} · ${i.categoria_abastecimento?.nome}`
                            : "já no cadastro — só entra na prateleira"}
                          {i.codigo_barras ? ` · ${i.codigo_barras}` : ""}
                        </span>
                        {i.avisos
                          .filter((a) => i.acao === "criar" || !a.startsWith("já existe"))
                          .map((a) => (
                            <span key={a} className="block text-[13px] text-laranja-texto">
                              ▲ {a}
                            </span>
                          ))}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-texto">{formatMoney(i.preco)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-sec">
                        {i.capacidade}/{i.nivel_ideal}/{i.nivel_alerta}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {previa.erros.length > 0 ? (
            <div className="mt-3 text-[14px]">
              <p className="m-0 text-sec">Linhas com erro ficam de fora — corrija e suba de novo, ou cadastre só o resto:</p>
              <ul className="mt-1.5 max-h-[20dvh] list-none overflow-y-auto p-0">
                {previa.erros.map((e) => (
                  <li key={e.linha} className="py-0.5 text-vermelho-texto">
                    ■ Linha {e.linha}
                    {e.nome ? ` (${e.nome})` : ""}: {e.motivo}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {!previa.escrita_liberada && total > 0 ? (
            <p className="mt-3 text-[14px] text-laranja-texto">
              ▲ A escrita na VMpay está travada neste ambiente — a conferência funciona, cadastrar não.
            </p>
          ) : null}
        </div>
      ) : null}

      {resultado ? (
        <div className="mt-5 flex flex-col gap-2 text-[14px]">
          <div className="flex flex-wrap gap-2">
            <Selo tom="verde">{formatInt(resultado.resumo.criados)} cadastrados</Selo>
            <Selo tom="verde">{formatInt(resultado.resumo.na_prateleira)} na prateleira</Selo>
            {resultado.resumo.erros > 0 ? <Selo tom="vermelho">{formatInt(resultado.resumo.erros)} recusados</Selo> : null}
          </div>
          {resultado.erro_prateleira ? (
            <p className="m-0 text-vermelho-texto">
              ■ A VMpay recusou a entrada na prateleira ({resultado.erro_prateleira}). Os produtos ficaram cadastrados:
              resolva o motivo e suba a mesma planilha de novo — ela só completa o que faltou.
            </p>
          ) : null}
          <ul className="m-0 max-h-[30dvh] list-none overflow-y-auto p-0">
            {resultado.linhas
              .filter((l) => l.status === "erro")
              .map((l) => (
                <li key={l.linha} className="py-0.5 text-vermelho-texto">
                  ■ Linha {l.linha}
                  {nomes.get(l.linha) ? ` (${nomes.get(l.linha)})` : ""}: {l.motivo}
                </li>
              ))}
          </ul>
        </div>
      ) : null}

      {erro ? (
        <p role="alert" className="mt-3 text-[14px] text-vermelho-texto">
          ■ {erro}
        </p>
      ) : null}

      <RodapeFolha>
        <Botao variante="tingido" tamanho="g" onClick={resultado ? () => onConcluido("Cadastro em lote concluído com pendências — veja acima.") : onFechar}>
          {resultado ? "Fechar" : "Cancelar"}
        </Botao>
        {resultado ? null : (
          <Botao
            variante="cheio"
            tamanho="g"
            onClick={aplicar}
            disabled={!previa || total === 0 || !previa.escrita_liberada || ocupado !== null}
          >
            {ocupado === "aplicando"
              ? "Cadastrando…"
              : total > 0
                ? `Cadastrar ${formatInt(total)} produto(s)`
                : "Cadastrar"}
          </Botao>
        )}
      </RodapeFolha>
    </Folha>
  );
}
