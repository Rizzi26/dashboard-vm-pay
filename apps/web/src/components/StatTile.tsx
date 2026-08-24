/**
 * Número em destaque. Sem gráfico e sem hover — quando o dado é um valor só, o
 * gráfico é ruído.
 */
export function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--grid)] bg-[var(--surface-1)] p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums text-[var(--text-primary)]">
        {value}
      </div>
      {hint ? (
        <div className="mt-1 text-xs text-[var(--text-secondary)]">{hint}</div>
      ) : null}
    </div>
  );
}
