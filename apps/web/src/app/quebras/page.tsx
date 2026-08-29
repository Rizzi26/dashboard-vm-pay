import Link from "next/link";

import { Card } from "@/components/Card";
import { Header } from "@/components/Header";
import { Offline } from "@/components/Offline";
import { StatTile } from "@/components/StatTile";
import { serverApi } from "@/lib/api.server";
import { formatDayTime, formatInt, formatMoney } from "@/lib/format";
import { orgSession } from "@/lib/org";

const DIAS_VALIDOS = [7, 30, 90] as const;

/**
 * Quebra ≠ venda perdida (/perdidas): lá é cliente que tentou comprar e não
 * conseguiu; aqui é saldo que sumiu da prateleira sem venda registrada —
 * furto, avaria ou ajuste feito direto na VMpay sem lançamento.
 */
export default async function QuebrasPage({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string }>;
}) {
  const { me, org } = await orgSession();
  const { dias: diasParam } = await searchParams;
  const dias = DIAS_VALIDOS.find((d) => String(d) === diasParam) ?? 30;
  const quebras = await serverApi.quebras(org.slug, dias);

  return (
    <div className="viz-root min-h-screen bg-[var(--surface-0)]">
      <Header orgName={org.name} role={org.role} email={me.email} local={org.local} />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
            Quebras de estoque
          </h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Saldo que caiu além das vendas registradas no intervalo entre duas
            sincronizações — furto, avaria ou ajuste sem lançamento.
          </p>
          <nav className="mt-3 inline-flex rounded-lg border border-[var(--grid)] p-1 text-sm">
            {DIAS_VALIDOS.map((d) => (
              <Link
                key={d}
                href={d === 30 ? "/quebras" : `/quebras?dias=${d}`}
                className={`rounded-md px-3 py-1.5 ${
                  d === dias
                    ? "bg-[var(--surface-1)] font-medium text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                {d} dias
              </Link>
            ))}
          </nav>
        </header>

        {quebras.ok ? (
          <>
            <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
              <StatTile
                label="Unidades sem venda"
                value={formatInt(quebras.data.resumo.unidades)}
                tone={quebras.data.resumo.unidades > 0 ? "critical" : undefined}
              />
              <StatTile
                label="Valor estimado"
                value={formatMoney(quebras.data.resumo.valor)}
                hint="a preço de venda; itens sem preço ficam de fora"
              />
              <StatTile
                label="Eventos"
                value={formatInt(quebras.data.resumo.eventos)}
                hint="cada evento é um intervalo entre sincronizações"
              />
            </div>

            {quebras.data.eventos.length === 0 ? (
              <p className="rounded-md border border-dashed border-[var(--grid)] p-8 text-center text-sm text-[var(--text-secondary)]">
                Nenhuma quebra detectada no período. O histórico acumula a cada
                sincronização — quanto mais fotos, mais fina a detecção.
              </p>
            ) : (
              <Card
                title="Eventos"
                subtitle="Queda de saldo × vendas do mesmo intervalo, do mais recente para o mais antigo."
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--grid)] text-left text-[11px] uppercase tracking-[0.08em] text-[var(--text-secondary)]">
                        <th className="py-2 font-medium">Produto</th>
                        <th className="py-2 font-medium">Intervalo</th>
                        <th className="py-2 text-right font-medium">Saiu</th>
                        <th className="py-2 text-right font-medium">Vendido</th>
                        <th className="py-2 text-right font-medium">Quebra</th>
                        <th className="py-2 text-right font-medium">Valor</th>
                      </tr>
                    </thead>
                    <tbody className="text-[var(--text-primary)]">
                      {quebras.data.eventos.map((e) => (
                        <tr
                          key={`${e.product_id}-${e.ate}`}
                          className="border-t border-[var(--grid)] hover:bg-[var(--row-hover)]"
                        >
                          <td className="py-2 pr-4">
                            <Link
                              href={`/produto/${e.product_id}`}
                              className="underline decoration-[var(--grid)] underline-offset-4 hover:decoration-[var(--accent)]"
                            >
                              {e.produto}
                            </Link>
                            <span className="block text-xs text-[var(--text-secondary)]">
                              {e.local}
                            </span>
                          </td>
                          <td className="py-2 pr-4 text-xs text-[var(--text-secondary)]">
                            {formatDayTime(e.de)} → {formatDayTime(e.ate)}
                          </td>
                          <td className="py-2 text-right tabular-nums">{formatInt(e.saida)}</td>
                          <td className="py-2 text-right tabular-nums">
                            {formatInt(e.vendidas)}
                          </td>
                          <td className="py-2 text-right font-medium tabular-nums text-[var(--status-critical)]">
                            {formatInt(e.quebra)}
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            {e.valor !== null ? formatMoney(e.valor) : "—"}
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
          <Offline error={quebras.error} />
        )}
      </main>
    </div>
  );
}
