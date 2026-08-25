import type { MachineRow } from "@/lib/api";
import { formatInt, formatMoney } from "@/lib/format";

export function MachineTable({ rows }: { rows: MachineRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-[var(--text-secondary)]">
        Nenhuma máquina com venda no período.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--grid)] text-left text-[11px] uppercase tracking-[0.08em] text-[var(--text-secondary)]">
            <th className="py-2.5 font-medium">Máquina</th>
            <th className="hidden py-2.5 font-medium sm:table-cell">Modelo</th>
            <th className="py-2.5 text-right font-medium">Faturamento</th>
            <th className="py-2.5 text-right font-medium">Transações</th>
          </tr>
        </thead>
        <tbody className="text-[var(--text-primary)]">
          {rows.map((row) => (
            <tr
              key={row.machine_id}
              className="border-t border-[var(--grid)] hover:bg-[var(--row-hover)]"
            >
              <td className="py-2.5">
                {/* A dimensão pode não ter sido ingerida ainda; o id sempre existe. */}
                {row.patrimonio ?? `#${row.machine_id}`}
                <span className="block text-xs text-[var(--text-secondary)] sm:hidden">
                  {row.modelo ?? "—"}
                </span>
              </td>
              <td className="hidden py-2.5 text-[var(--text-secondary)] sm:table-cell">
                {row.modelo ?? "—"}
              </td>
              <td className="py-2.5 text-right tabular-nums">{formatMoney(row.faturamento)}</td>
              <td className="py-2.5 text-right tabular-nums">{formatInt(row.transacoes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
