import Link from "next/link";

import { Card } from "@/components/Card";
import { Header } from "@/components/Header";
import { Offline } from "@/components/Offline";
import { StatTile } from "@/components/StatTile";
import { serverApi } from "@/lib/api.server";
import { formatInt } from "@/lib/format";
import { orgSession } from "@/lib/org";

/**
 * Lista de compra do repositor: produto que VENDE e está zerado ou acabando.
 * Três colunas de propósito — a decisão aqui é "o que levar e quanto"; o
 * ritmo de venda vira subtexto e o resto (risco, última venda) mora na ficha
 * do produto. Ruptura de produto morto fica de fora: sortimento é outra
 * decisão, e o lugar dela é o /estoque.
 */
export default async function ReposicaoPage() {
  const { me, org } = await orgSession();
  const reposicao = await serverApi.reposicao(org.slug);

  return (
    <div className="viz-root min-h-screen bg-[var(--surface-0)]">
      <Header orgName={org.name} role={org.role} email={me.email} local={org.local} />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
            Reposição
          </h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            O que levar na próxima visita — só produto que vende, o mais
            importante primeiro.
          </p>
        </header>

        {reposicao.ok ? (
          <>
            <div className="mb-6 grid grid-cols-2 gap-4">
              <StatTile
                label="Zerados"
                value={formatInt(reposicao.data.resumo.ruptura)}
                tone={reposicao.data.resumo.ruptura > 0 ? "critical" : undefined}
                hint="vendiam e acabaram"
              />
              <StatTile
                label="Acabando"
                value={formatInt(reposicao.data.resumo.acabando)}
                tone={reposicao.data.resumo.acabando > 0 ? "warning" : undefined}
                hint="duram menos de 5 dias"
              />
            </div>

            {reposicao.data.itens.length === 0 ? (
              <p className="rounded-md border border-dashed border-[var(--grid)] p-8 text-center text-sm text-[var(--text-secondary)]">
                Nada para repor: nenhum produto com venda recente está zerado ou
                acabando.
              </p>
            ) : (
              <Card
                title="Lista de compra"
                subtitle="A sugestão cobre uma semana de venda no ritmo atual."
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--grid)] text-left text-[11px] uppercase tracking-[0.08em] text-[var(--text-secondary)]">
                        <th className="py-2 font-medium">Produto</th>
                        <th className="py-2 font-medium">Situação</th>
                        <th className="py-2 text-right font-medium">Levar</th>
                      </tr>
                    </thead>
                    <tbody className="text-[var(--text-primary)]">
                      {reposicao.data.itens.map((i) => (
                        <tr
                          key={`${i.location_id}-${i.product_id}`}
                          className="border-t border-[var(--grid)] hover:bg-[var(--row-hover)]"
                        >
                          <td className="py-2 pr-4">
                            <Link
                              href={`/produto/${i.product_id}`}
                              className="underline decoration-[var(--grid)] underline-offset-4 hover:decoration-[var(--accent)]"
                            >
                              {i.produto}
                            </Link>
                            <span className="block text-xs text-[var(--text-secondary)]">
                              vende ~
                              {i.por_dia.toLocaleString("pt-BR", {
                                maximumFractionDigits: 1,
                              })}
                              /dia
                            </span>
                          </td>
                          <td className="py-2 pr-4">
                            {i.status === "ruptura" ? (
                              <span className="font-medium text-[var(--status-critical)]">
                                zerado
                              </span>
                            ) : (
                              <span className="text-[var(--status-warning)]">
                                restam {formatInt(i.quantidade)} (~
                                {formatInt(i.dias_restantes)} d)
                              </span>
                            )}
                          </td>
                          <td className="py-2 text-right text-base font-semibold tabular-nums">
                            {formatInt(i.sugestao)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </>
        ) : (
          <Offline error={reposicao.error} />
        )}
      </main>
    </div>
  );
}
