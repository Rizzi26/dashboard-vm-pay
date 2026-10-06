"use client";

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

      <Lista como="ol" rotulo="Produtos por faturamento">
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
            // As porcentagens só a partir do tablet: no celular a classe já diz o essencial.
            secundario={
              <span className="hidden tabular-nums md:inline">
                {pct(i.participacao)} do faturamento · {pct(i.acumulado)} acumulado
              </span>
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
