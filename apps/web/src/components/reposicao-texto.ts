// Textos da Reposição, num módulo sem "use client": a página (servidor) e a
// lista do celular (cliente) usam os mesmos — função exportada de módulo de
// cliente chega ao servidor como referência, não como função.
import type { ReposicaoItem } from "@/lib/api";
import { formatInt, formatMoney } from "@/lib/format";

export const POR_PAGINA_REPOSICAO = 20;

export function ritmo(porDia: number): string {
  if (porDia >= 1) {
    const n = porDia.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
    return `~${n} por dia`;
  }
  return `~${Math.max(1, Math.round(porDia * 7))} por semana`;
}

function dias(n: number): string {
  return `~${formatInt(n)} ${Math.round(n) === 1 ? "dia" : "dias"}`;
}

/** Linha de baixo de cada item. `curto` é o do celular, sem o ritmo de venda. */
export function detalheItem(i: ReposicaoItem, curto = false, comLoja = false): string {
  const base =
    i.status === "ruptura"
      ? `vendia ${ritmo(i.por_dia)}`
      : curto
        ? `restam ${formatInt(i.quantidade)} · ${dias(i.dias_restantes)}`
        : `restam ${formatInt(i.quantidade)} — dá para ${dias(i.dias_restantes)} · vende ${ritmo(i.por_dia)}`;
  return comLoja ? `${base} · ${i.local}` : base;
}

/**
 * O resumo em linguagem corrida: por onde começar e quanto custa esperar.
 * Sai dos itens já filtrados pela loja — o `resumo` da API é da organização.
 */
export function insightReposicao(zerados: ReposicaoItem[], acabando: ReposicaoItem[]): string {
  const frases: string[] = [];
  if (zerados.length > 0) {
    const perdida = zerados.reduce((s, i) => s + (i.risco_dia ?? 0), 0);
    frases.push(
      perdida > 0
        ? `Leve primeiro os zerados: cada dia sem repor deixa de vender cerca de ${formatMoney(perdida)}.`
        : "Leve primeiro os zerados: cada dia sem repor é venda perdida.",
    );
  }
  if (acabando.length > 0) {
    const primeiro = acabando.reduce((a, b) => (b.dias_restantes < a.dias_restantes ? b : a));
    frases.push(
      `Os acabando duram menos de 5 dias — o primeiro a faltar deve ser ${primeiro.produto}, em ${dias(primeiro.dias_restantes)}.`,
    );
  }
  return frases.join(" ");
}
