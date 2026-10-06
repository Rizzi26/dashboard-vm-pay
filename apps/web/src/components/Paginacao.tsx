"use client";

import { useState } from "react";

/**
 * Paginação das listas do painel — nenhuma tabela rola sem fim. Mesmo visual
 * em todas as telas; os controles somem quando tudo cabe numa página.
 *
 * Telas de servidor (página na URL) usam PaginacaoLinks; esta é a das telas
 * interativas, com a página no estado.
 */
export function usePaginacao<T>(itens: T[], porPagina = 20) {
  const [pagina, setPagina] = useState(0);
  const total = itens.length;
  const totalPaginas = Math.max(1, Math.ceil(total / porPagina));
  // Filtro/busca encolhe a lista: a página atual nunca passa da última.
  const atual = Math.min(pagina, totalPaginas - 1);
  return {
    visiveis: itens.slice(atual * porPagina, (atual + 1) * porPagina),
    pagina: atual,
    totalPaginas,
    setPagina,
    rodape: { pagina: atual, totalPaginas, total, porPagina, onMudar: setPagina },
  };
}

export function Paginacao({
  pagina,
  totalPaginas,
  total,
  porPagina,
  onMudar,
  rotulo = "itens",
}: {
  pagina: number;
  totalPaginas: number;
  total: number;
  porPagina: number;
  onMudar: (pagina: number) => void;
  rotulo?: string;
}) {
  if (totalPaginas <= 1) return null;
  const inicio = pagina * porPagina + 1;
  const fim = Math.min((pagina + 1) * porPagina, total);
  return (
    <nav
      aria-label="Paginação"
      className="mt-4 flex flex-col gap-2 text-sm text-[var(--text-secondary)] sm:flex-row sm:items-center sm:justify-between"
    >
      <span className="tabular-nums">
        {inicio}–{fim} de {total} {rotulo}
      </span>
      <span className="flex items-center gap-2">
        <button
          type="button"
          disabled={pagina === 0}
          onClick={() => onMudar(pagina - 1)}
          className="rounded-md border border-[var(--grid)] px-4 py-2 disabled:opacity-40"
        >
          ← Anterior
        </button>
        <span className="tabular-nums">
          {pagina + 1}/{totalPaginas}
        </span>
        <button
          type="button"
          disabled={pagina >= totalPaginas - 1}
          onClick={() => onMudar(pagina + 1)}
          className="rounded-md border border-[var(--grid)] px-4 py-2 disabled:opacity-40"
        >
          Próxima →
        </button>
      </span>
    </nav>
  );
}
