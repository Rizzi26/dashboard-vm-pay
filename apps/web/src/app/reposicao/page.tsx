import Link from "next/link";

import { Card } from "@/components/Card";
import { Header } from "@/components/Header";
import { Offline } from "@/components/Offline";
import { StatTile } from "@/components/StatTile";
import { serverApi } from "@/lib/api.server";
import { formatDay, formatInt, formatMoney } from "@/lib/format";
import { orgSession } from "@/lib/org";

/**
 * Lista de compra do repositor: produto que VENDE e está zerado ou acabando.
 * Ruptura de produto morto fica de fora — isso é decisão de sortimento, e o
 * lugar dela é o /estoque com o filtro de ruptura.
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
            O que levar na próxima visita, pelo ritmo de venda dos últimos{" "}
            {reposicao.ok ? reposicao.data.dias : 30} dias — ordenado pelo
            faturamento diário em risco.
          </p>
        </header>

        {reposicao.ok ? (
          <>
            <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
              <StatTile
                label="Zerados que vendem"
                value={formatInt(reposicao.data.resumo.ruptura)}
                tone={reposicao.data.resumo.ruptura > 0 ? "critical" : undefined}
              />
              <StatTile
                label="Acabando"
                value={formatInt(reposicao.data.resumo.acabando)}
                tone={reposicao.data.resumo.acabando > 0 ? "warning" : undefined}
                hint="saldo cobre menos de 5 dias de venda"
              />
              <StatTile
                label="Risco por dia"
                value={formatMoney(reposicao.data.resumo.risco_dia)}
                hint="faturamento diário dos itens desta lista"
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
                subtitle="Sugestão cobre uma semana de venda no ritmo atual."
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--grid)] text-left text-[11px] uppercase tracking-[0.08em] text-[var(--text-secondary)]">
                        <th className="py-2 font-medium">Produto</th>
                        <th className="py-2 font-medium">Situação</th>
                        <th className="py-2 text-right font-medium">Vende/dia</th>
                        <th className="py-2 text-right font-medium">Última venda</th>
                        <th className="py-2 text-right font-medium">Risco/dia</th>
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
                              {i.local}
                            </span>
                          </td>
                          <td className="py-2 pr-4">
                            {i.status === "ruptura" ? (
                              <span className="font-medium text-[var(--status-critical)]">
                                zerado
                              </span>
                            ) : (
                              <span className="text-[var(--status-warning)]">
                                acaba em ~{formatInt(i.dias_restantes)} d ({formatInt(i.quantidade)} un.)
                              </span>
                            )}
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            {i.por_dia.toLocaleString("pt-BR", {
                              maximumFractionDigits: 2,
                            })}
                          </td>
                          <td className="py-2 text-right tabular-nums text-[var(--text-secondary)]">
                            {i.ultima_venda ? formatDay(i.ultima_venda.slice(0, 10)) : "—"}
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            {i.risco_dia !== null ? formatMoney(i.risco_dia) : "—"}
                          </td>
                          <td className="py-2 text-right font-medium tabular-nums">
                            {formatInt(i.sugestao)} un.
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
