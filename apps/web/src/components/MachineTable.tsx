import type { MachineRow } from "@/lib/api";
import { LinhaLista, Lista } from "@/components/ui/Lista";
import { formatInt, formatMoney } from "@/lib/format";

export function MachineTable({ rows }: { rows: MachineRow[] }) {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-sec">Nenhuma máquina com venda no período.</p>;
  }
  return (
    <Lista rotulo="Máquinas por faturamento">
      {rows.map((row) => (
        <LinhaLista
          key={row.machine_id}
          // A dimensão pode não ter sido ingerida ainda; o id sempre existe.
          principal={row.patrimonio ?? `#${row.machine_id}`}
          secundario={row.modelo ?? "—"}
          direita={
            <span className="flex flex-col items-end">
              <span className="font-semibold tabular-nums text-texto">{formatMoney(row.faturamento)}</span>
              <span className="text-[13px] tabular-nums text-sec">
                {formatInt(row.transacoes)} transaç{row.transacoes === 1 ? "ão" : "ões"}
              </span>
            </span>
          }
        />
      ))}
    </Lista>
  );
}
