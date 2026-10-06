import Link from "next/link";
import { PAGINACAO_NAV, PAGINACAO_SETA, PAGINACAO_SETA_OFF } from "@/components/ui/paginacao-estilo";

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
  return (
    <nav aria-label="Paginação" className={PAGINACAO_NAV}>
      <span className="tabular-nums">
        {inicio}–{fim} de {total} {rotulo}
      </span>
      <span className="flex items-center gap-2">
        {atual > 1 ? (
          <Link href={href(atual - 1)} scroll={false} aria-label="Página anterior" className={PAGINACAO_SETA}>
            <span aria-hidden="true">‹</span>
          </Link>
        ) : (
          <span aria-hidden="true" className={PAGINACAO_SETA_OFF}>
            ‹
          </span>
        )}
        <span className="tabular-nums">
          {atual} de {totalPaginas}
        </span>
        {atual < totalPaginas ? (
          <Link href={href(atual + 1)} scroll={false} aria-label="Próxima página" className={PAGINACAO_SETA}>
            <span aria-hidden="true">›</span>
          </Link>
        ) : (
          <span aria-hidden="true" className={PAGINACAO_SETA_OFF}>
            ›
          </span>
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
