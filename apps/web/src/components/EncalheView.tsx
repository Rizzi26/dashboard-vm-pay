import Link from "next/link";
import type { Encalhe } from "@/lib/api";
import { StatTile } from "@/components/StatTile";
import { formatDay, formatInt, formatMoney } from "@/lib/format";

/**
 * Encalhados: itens com saldo na prateleira e sem venda há N dias. Ocupam
 * canaleta e prendem dinheiro — é a lista para decidir o que sai do
 * planograma. O valor é a preço de venda (o que a canaleta deixa de faturar).
 */
export function EncalheView({ dados }: { dados: Encalhe }) {
  if (dados.itens.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-[var(--grid)] p-8 text-center text-sm text-[var(--text-secondary)]">
        Nada encalhado: todo item com saldo vendeu nos últimos {dados.dias} dias.
      </p>
    );
  }
  const varias = new Set(dados.itens.map((i) => i.location_id)).size > 1;
  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Itens encalhados" value={formatInt(dados.resumo.itens)} hint={`sem venda há ${dados.dias}+ dias`} tone="warning" />
        <StatTile label="Unidades paradas" value={formatInt(dados.resumo.unidades)} />
        <StatTile label="Valor parado" value={formatMoney(dados.resumo.valor_parado)} hint="a preço de venda" />
        <StatTile label="Nunca venderam" value={formatInt(dados.resumo.nunca_venderam)} hint="desde que o painel lê a loja" />
      </div>

      <ul className="divide-y divide-[var(--grid)] rounded-xl border border-[var(--grid)] bg-[var(--surface-1)]">
        {dados.itens.map((i) => (
          <li key={`${i.location_id}-${i.product_id}`} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
            <div className="min-w-0">
              <Link href={`/produto/${i.product_id}`} className="text-sm font-medium text-[var(--text-primary)] hover:underline">
                {i.produto}
              </Link>
              <p className="text-xs text-[var(--text-secondary)]">
                {varias ? `${i.local} · ` : ""}
                {i.ultima_venda ? `última venda em ${formatDay(i.ultima_venda)}` : "nunca vendeu"}
              </p>
            </div>
            <p className="shrink-0 text-right text-sm tabular-nums text-[var(--text-primary)]">
              {formatInt(i.quantidade)} un.
              <span className="block text-xs text-[var(--text-secondary)]">
                {i.valor_parado !== null ? formatMoney(i.valor_parado) : "sem preço"}
              </span>
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}
