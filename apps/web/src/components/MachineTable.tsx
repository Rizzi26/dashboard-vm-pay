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
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs uppercase text-[var(--text-secondary)]">
          <th className="py-2 font-medium">Máquina</th>
          <th className="py-2 font-medium">Modelo</th>
          <th className="py-2 text-right font-medium">Faturamento</th>
          <th className="py-2 text-right font-medium">Transações</th>
        </tr>
      </thead>
      <tbody className="text-[var(--text-primary)]">
        {rows.map((row) => (
          <tr key={row.machine_id} className="border-t border-[var(--grid)]">
            <td className="py-2">
              {/* A dimensão pode não ter sido ingerida ainda; o id sempre existe. */}
              {row.patrimonio ?? `#${row.machine_id}`}
            </td>
            <td className="py-2 text-[var(--text-secondary)]">{row.modelo ?? "—"}</td>
            <td className="py-2 text-right tabular-nums">{formatMoney(row.faturamento)}</td>
            <td className="py-2 text-right tabular-nums">{formatInt(row.transacoes)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
