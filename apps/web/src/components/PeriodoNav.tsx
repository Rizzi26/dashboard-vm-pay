import Link from "next/link";
import { PERIODOS } from "@/lib/periodos";

/**
 * Segmented control de período — neutro de propósito: cor fica para dados e
 * ações. Server component; a seleção viaja pela URL, não por estado.
 */
export function PeriodoNav({
  basePath,
  periodo,
}: {
  basePath: string;
  periodo: string;
}) {
  return (
    <nav
      aria-label="Período"
      className="mt-3 inline-flex max-w-full overflow-x-auto rounded-lg border border-[var(--grid)] bg-[var(--surface-0)] p-0.5"
    >
      {PERIODOS.map((p) => (
        <Link
          key={p.key}
          href={p.key === "30" ? basePath : `${basePath}?periodo=${p.key}`}
          className={
            p.key === periodo
              ? "flex min-h-11 items-center whitespace-nowrap rounded-md px-3 text-sm bg-[var(--surface-1)] font-medium text-[var(--text-primary)] shadow-[var(--shadow-card)]"
              : "flex min-h-11 items-center whitespace-nowrap rounded-md px-3 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          }
        >
          {p.label}
        </Link>
      ))}
    </nav>
  );
}
