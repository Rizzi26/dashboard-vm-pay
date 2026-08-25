/**
 * Número em destaque. Sem gráfico e sem hover — quando o dado é um valor só, o
 * gráfico é ruído. Com onClick, o tile vira botão de filtro (ver StockView).
 */
export function StatTile({
  label,
  value,
  hint,
  tone,
  onClick,
  active,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "critical" | "warning";
  onClick?: () => void;
  active?: boolean;
}) {
  const valueColor =
    tone === "critical"
      ? "text-[var(--status-critical)]"
      : tone === "warning"
        ? "text-[var(--status-warning)]"
        : "text-[var(--text-primary)]";

  const boxClasses = `rounded-xl border ${
    active ? "border-[var(--accent)]" : "border-[var(--grid)]"
  } bg-[var(--surface-1)] p-5 shadow-[var(--shadow-card)]`;

  const inner = (
    <>
      <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-secondary)]">
        {label}
      </div>
      <div
        className={`mt-2 text-[1.75rem] leading-tight tracking-tight font-semibold tabular-nums ${valueColor}`}
      >
        {value}
      </div>
      {hint ? (
        <div className="mt-1 text-xs text-[var(--text-secondary)]">{hint}</div>
      ) : null}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className={`w-full text-left ${boxClasses}`}
      >
        {inner}
      </button>
    );
  }

  return <div className={boxClasses}>{inner}</div>;
}
