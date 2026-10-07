"use client";

import Link from "next/link";
import type { CurvaAbc as Dados } from "@/lib/api";
import { Paginacao, usePaginacao } from "@/components/Paginacao";
import { LinhaLista, Lista } from "@/components/ui/Lista";
import { Selo, type TomSelo } from "@/components/ui/Selo";
import { formatInt, formatMoney } from "@/lib/format";

const pct = (v: number) => `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

const SIGNIFICADO: Record<string, string> = {
  A: "80% do faturamento",
  B: "os 15% seguintes",
  C: "os últimos 5%",
};

// Só A ganha tinta: é a classe que pede atenção. B e C se distinguem pela
// letra — a classe é rótulo, não magnitude, então não entra numa rampa.
const TOM: Record<"A" | "B" | "C", TomSelo> = { A: "azul", B: "cinza", C: "cinza" };

/**
 * Curva ABC: os poucos produtos que carregam o faturamento. Orienta o que
 * manter, destacar ou tirar do planograma.
 */
export function CurvaAbc({ dados }: { dados: Dados }) {
  const pag = usePaginacao(dados.itens, 20);
  if (dados.itens.length === 0) {
    return <p className="text-sm text-sec">Sem vendas no período.</p>;
  }

  return (
    <div>
      <p className="mb-3 text-[13px] text-sec">
        {(["A", "B", "C"] as const).map((c, k) => (
          <span key={c}>
            {k > 0 ? " · " : ""}
            <strong className="font-semibold text-texto">{c}</strong> {formatInt(dados.resumo[c].produtos)}{" "}
            produto{dados.resumo[c].produtos === 1 ? "" : "s"}, {SIGNIFICADO[c]}
          </span>
        ))}
      </p>

      {/* Do tablet para cima o cartão tem a largura toda: cabe a tabela com
          as colunas que no celular ficam de fora. */}
      <div className="hidden md:block">
        {/* table-fixed: as colunas numéricas ficam na largura declarada e o
            produto leva o resto — no layout automático ele encolhia e cortava. */}
        <table className="w-full table-fixed text-sm">
          <caption className="sr-only">Produtos por faturamento</caption>
          <thead>
            <tr className="border-b border-sep text-left text-[12px] text-sec">
              <th scope="col" className="w-10 py-2 pr-2 text-right font-medium">#</th>
              <th scope="col" className="py-2 pl-2 font-medium">Produto</th>
              <th scope="col" className="w-24 py-2 pl-3 text-right font-medium">Unidades</th>
              <th scope="col" className="w-32 py-2 pl-3 text-right font-medium">Faturamento</th>
              <th scope="col" className="w-24 py-2 pl-3 text-right font-medium">% do total</th>
              <th scope="col" className="w-24 py-2 pl-3 text-right font-medium">Acumulado</th>
              <th scope="col" className="w-16 py-2 pl-3 text-center font-medium">Classe</th>
            </tr>
          </thead>
          <tbody className="text-texto">
            {pag.visiveis.map((i) => (
              <tr key={i.posicao} className="border-t border-sep hover:bg-[var(--row-hover)]">
                <td className="py-2 pr-2 text-right tabular-nums text-sec">{i.posicao}</td>
                <td className="max-w-0 py-2 pl-2">
                  {i.product_id ? (
                    <Link href={`/produto/${i.product_id}`} className="block truncate text-texto no-underline hover:underline" title={i.produto}>
                      {i.produto}
                    </Link>
                  ) : (
                    <span className="block truncate" title={i.produto}>
                      {i.produto}
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap py-2 pl-3 text-right tabular-nums">{formatInt(i.unidades)}</td>
                <td className="whitespace-nowrap py-2 pl-3 text-right tabular-nums">{formatMoney(i.faturamento)}</td>
                <td className="whitespace-nowrap py-2 pl-3 text-right tabular-nums">{pct(i.participacao)}</td>
                <td className="whitespace-nowrap py-2 pl-3 text-right tabular-nums text-sec">{pct(i.acumulado)}</td>
                <td className="py-2 pl-3 text-center">
                  <Selo tom={TOM[i.classe]} simbolo={null} className="min-w-7 justify-center">
                    <span className="sr-only">Classe </span>
                    {i.classe}
                  </Selo>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Lista como="ol" rotulo="Produtos por faturamento" className="md:hidden">
        {pag.visiveis.map((i) => (
          <LinhaLista
            key={i.posicao}
            esquerda={
              <Selo tom={TOM[i.classe]} simbolo={null} className="min-w-7 justify-center">
                <span className="sr-only">Classe </span>
                {i.classe}
              </Selo>
            }
            principal={
              <>
                <span className="mr-1.5 text-[13px] tabular-nums text-sec">{i.posicao}.</span>
                {i.produto}
              </>
            }
            direita={<span className="tabular-nums text-texto">{formatMoney(i.faturamento)}</span>}
            href={i.product_id ? `/produto/${i.product_id}` : undefined}
          />
        ))}
      </Lista>
      <Paginacao {...pag.rodape} rotulo="produtos" />
    </div>
  );
}
