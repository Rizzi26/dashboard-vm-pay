import Link from "next/link";

/**
 * Paginação das telas de servidor: a página vai na URL (sobrevive ao recarregar
 * e ao "voltar"). Mesmo visual de Paginacao; some quando tudo cabe numa página.
 * `pagina` começa em 1, como aparece na URL.
 */
export function PaginacaoLinks({
  pagina,
  total,
  porPagina,
  href,
  rotulo = "itens",
}: {
  pagina: number;
  total: number;
  porPagina: number;
  href: (pagina: number) => string;
  rotulo?: string;
}) {
  const totalPaginas = Math.max(1, Math.ceil(total / porPagina));
  if (totalPaginas <= 1) return null;
  const atual = Math.min(Math.max(1, pagina), totalPaginas);
  const inicio = (atual - 1) * porPagina + 1;
  const fim = Math.min(atual * porPagina, total);
  const botao = "rounded-md border border-[var(--grid)] px-4 py-2";
  return (
    <nav
      aria-label="Paginação"
      className="mt-4 flex flex-col gap-2 text-sm text-[var(--text-secondary)] sm:flex-row sm:items-center sm:justify-between"
    >
      <span className="tabular-nums">
        {inicio}–{fim} de {total} {rotulo}
      </span>
      <span className="flex items-center gap-2">
        {atual > 1 ? (
          <Link href={href(atual - 1)} scroll={false} className={botao}>
            ← Anterior
          </Link>
        ) : (
          <span className={`${botao} opacity-40`}>← Anterior</span>
        )}
        <span className="tabular-nums">
          {atual}/{totalPaginas}
        </span>
        {atual < totalPaginas ? (
          <Link href={href(atual + 1)} scroll={false} className={botao}>
            Próxima →
          </Link>
        ) : (
          <span className={`${botao} opacity-40`}>Próxima →</span>
        )}
      </span>
    </nav>
  );
}

/** Página pedida na URL ("2" → 2); qualquer coisa inválida vira 1. */
export function paginaDaUrl(valor: string | undefined): number {
  const n = Number(valor);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}
