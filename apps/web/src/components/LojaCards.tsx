"use client";

import { useRouter } from "next/navigation";
import type { LojaCard } from "@/lib/api";
import { escolherLoja } from "@/components/LojaSelector";
import { formatAtraso, formatInt, formatMoney } from "@/lib/format";

function idadeSeg(iso: string | null): number | null {
  return iso ? Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000)) : null;
}

/** Um cartão por loja; os botões entram NA loja (escolhem e navegam). */
export function LojaCards({ lojas }: { lojas: LojaCard[] }) {
  const router = useRouter();

  function entrar(id: string, destino: string) {
    escolherLoja(id);
    router.push(destino);
    router.refresh();
  }

  return (
    <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {lojas.map((l) => {
        const semVendaHa = idadeSeg(l.vendas.ultima_venda);
        const atencao = l.estoque.zerados > 0 || l.estoque.acabando > 0;
        return (
          <li
            key={l.id}
            className="flex flex-col rounded-xl border border-[var(--grid)] bg-[var(--surface-1)] p-5 shadow-[var(--shadow-card)]"
          >
            <div className="flex items-start justify-between gap-3">
              <h2 className="min-w-0 text-base font-semibold text-[var(--text-primary)]">{l.nome}</h2>
              <span className="shrink-0 text-xs text-[var(--text-secondary)]">
                {semVendaHa === null ? "sem vendas em 30 dias" : `última venda ${formatAtraso(semVendaHa)}`}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-[var(--text-secondary)]">Hoje</div>
                <div className="mt-1 text-xl font-semibold tabular-nums text-[var(--text-primary)]">
                  {formatMoney(l.vendas.hoje)}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-[var(--text-secondary)]">7 dias</div>
                <div className="mt-1 text-base font-medium tabular-nums text-[var(--text-primary)]">
                  {formatMoney(l.vendas.d7)}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-[var(--text-secondary)]">30 dias</div>
                <div className="mt-1 text-base font-medium tabular-nums text-[var(--text-primary)]">
                  {formatMoney(l.vendas.d30)}
                </div>
                <div className="text-[11px] tabular-nums text-[var(--text-secondary)]">
                  ticket {formatMoney(l.vendas.ticket_30d)}
                </div>
              </div>
            </div>

            <p className="mt-4 text-sm text-[var(--text-secondary)]">
              {atencao ? (
                <span className="text-[var(--status-warning)]">
                  ▲ {formatInt(l.estoque.zerados)} zerado{l.estoque.zerados === 1 ? "" : "s"}
                  {" · "}
                  {formatInt(l.estoque.acabando)} acabando
                </span>
              ) : (
                <span>● prateleira sem rupturas</span>
              )}
              <span>
                {" · "}
                {formatInt(l.estoque.itens)} itens, lida {formatAtraso(idadeSeg(l.estoque.atualizado_em))}
              </span>
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => entrar(l.id, "/vendas")}
                className="rounded-md border border-[var(--grid)] px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--row-hover)]"
              >
                Vendas
              </button>
              <button
                type="button"
                onClick={() => entrar(l.id, "/prateleira")}
                className="rounded-md border border-[var(--grid)] px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--row-hover)]"
              >
                Prateleira
              </button>
              <button
                type="button"
                onClick={() => entrar(l.id, "/reposicao")}
                className={
                  atencao
                    ? "rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--accent-contrast)]"
                    : "rounded-md border border-[var(--grid)] px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--row-hover)]"
                }
              >
                O que repor
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
