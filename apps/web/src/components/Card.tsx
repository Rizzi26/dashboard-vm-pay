export function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[var(--grid)] bg-[var(--surface-1)] p-5 shadow-[var(--shadow-card)]">
      <header className="mb-3">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h2>
        {subtitle ? (
          <p className="text-xs text-[var(--text-secondary)]">{subtitle}</p>
        ) : null}
      </header>
      {children}
    </section>
  );
}
