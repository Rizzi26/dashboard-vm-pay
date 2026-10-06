"use client";

import Link from "next/link";
import type { CurvaAbc as Dados } from "@/lib/api";
import { Paginacao, usePaginacao } from "@/components/Paginacao";
import { formatInt, formatMoney } from "@/lib/format";

const pct = (v: number) => `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

const SIGNIFICADO: Record<string, string> = {
  A: "fazem 80% do faturamento",
  B: "os 15% seguintes",
  C: "os últimos 5%",
};

/**
 * Curva ABC: os poucos produtos que carregam o faturamento. A classe vai em
 * texto (letra), não em cor — é rótulo, não magnitude. Junto com Encalhados,
 * orienta o que manter, destacar ou tirar do planograma.
 */
export function CurvaAbc({ dados }: { dados: Dados }) {
  const pag = usePaginacao(dados.itens, 20);
  if (dados.itens.length === 0) {
    return <p className="text-sm text-[var(--text-secondary)]">Sem vendas no período.</p>;
  }
  const vendidos = dados.itens.length;

  return (
    <div>
      <p className="text-sm text-[var(--text-primary)]">
        <strong>{formatInt(dados.resumo.A.produtos)}</strong> de {formatInt(vendidos)} produtos vendidos (
        {pct(dados.resumo.A.produtos / vendidos)}) fazem 80% do faturamento.
      </p>

      <div className="mt-3 grid grid-cols-3 gap-3">
        {(["A", "B", "C"] as const).map((c) => (
          <div key={c} className="rounded-lg border border-[var(--grid)] px-3 py-2">
            <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-secondary)]">Classe {c}</div>
            <div className="text-lg font-semibold tabular-nums text-[var(--text-primary)]">
              {formatInt(dados.resumo[c].produtos)} <span className="text-xs font-normal text-[var(--text-secondary)]">produtos</span>
            </div>
            <div className="text-xs text-[var(--text-secondary)]">{SIGNIFICADO[c]}</div>
          </div>
        ))}
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-[var(--text-secondary)]">
              <th className="py-1 pr-2 font-normal">#</th>
              <th className="py-1 font-normal">Produto</th>
              <th className="py-1 text-right font-normal">Faturamento</th>
              {/* As porcentagens só a partir do tablet: no celular a classe já diz o essencial. */}
              <th className="hidden py-1 text-right font-normal sm:table-cell">% do total</th>
              <th className="hidden py-1 text-right font-normal sm:table-cell">Acumulado</th>
              <th className="py-1 pl-3 text-center font-normal">Classe</th>
            </tr>
          </thead>
          <tbody>
            {pag.visiveis.map((i) => (
              <tr key={i.posicao} className="border-t border-[var(--grid)] tabular-nums text-[var(--text-primary)]">
                <td className="py-1.5 pr-2 text-[var(--text-secondary)]">{i.posicao}</td>
                <td className="py-1.5">
                  {i.product_id ? (
                    <Link href={`/produto/${i.product_id}`} className="hover:underline">
                      {i.produto}
                    </Link>
                  ) : (
                    i.produto
                  )}
                </td>
                <td className="py-1.5 text-right">{formatMoney(i.faturamento)}</td>
                <td className="hidden py-1.5 text-right sm:table-cell">{pct(i.participacao)}</td>
                <td className="hidden py-1.5 text-right text-[var(--text-secondary)] sm:table-cell">{pct(i.acumulado)}</td>
                <td className="py-1.5 pl-3 text-center font-semibold">{i.classe}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Paginacao {...pag.rodape} rotulo="produtos" />
    </div>
  );
}
