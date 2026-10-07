"use client";

import { useState } from "react";
import { PAGINACAO_NAV, PAGINACAO_SETA, PAGINACAO_SETA_OFF } from "@/components/ui/paginacao-estilo";

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
    <nav aria-label="Paginação" className={PAGINACAO_NAV}>
      <span className="tabular-nums">
        {inicio}–{fim} de {total} {rotulo}
      </span>
      <span className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Página anterior"
          disabled={pagina === 0}
          onClick={() => onMudar(pagina - 1)}
          className={pagina === 0 ? PAGINACAO_SETA_OFF : PAGINACAO_SETA}
        >
          <span aria-hidden="true">‹</span>
        </button>
        <span className="tabular-nums">
          {pagina + 1} de {totalPaginas}
        </span>
        <button
          type="button"
          aria-label="Próxima página"
          disabled={pagina >= totalPaginas - 1}
          onClick={() => onMudar(pagina + 1)}
          className={pagina >= totalPaginas - 1 ? PAGINACAO_SETA_OFF : PAGINACAO_SETA}
        >
          <span aria-hidden="true">›</span>
        </button>
      </span>
    </nav>
  );
}
