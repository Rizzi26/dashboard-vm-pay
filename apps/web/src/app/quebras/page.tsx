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
 * conseguiu; aqui é produto que saiu da prateleira sem venda registrada.
 * A tela é agregada por produto — o intervalo de cada queda é mecânica de
 * detecção e ficava confuso exposto na tabela.
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
            Quebras
          </h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Produto que saiu da prateleira sem venda registrada.
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
            <div className="mb-6 grid grid-cols-2 gap-4">
              <StatTile
                label="Unidades"
                value={formatInt(quebras.data.resumo.unidades)}
                tone={quebras.data.resumo.unidades > 0 ? "critical" : undefined}
              />
              <StatTile
                label="Prejuízo estimado"
                value={formatMoney(quebras.data.resumo.valor)}
                hint="a preço de venda"
              />
            </div>

            {quebras.data.itens.length === 0 ? (
              <p className="rounded-md border border-dashed border-[var(--grid)] p-8 text-center text-sm text-[var(--text-secondary)]">
                Nenhuma quebra detectada no período.
              </p>
            ) : (
              <Card title="Por produto" subtitle="Do maior sumiço para o menor.">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--grid)] text-left text-[11px] uppercase tracking-[0.08em] text-[var(--text-secondary)]">
                        <th className="py-2 font-medium">Produto</th>
                        <th className="py-2 text-right font-medium">Sumiram</th>
                        <th className="py-2 text-right font-medium">Prejuízo</th>
                        <th className="py-2 text-right font-medium">Última vez</th>
                      </tr>
                    </thead>
                    <tbody className="text-[var(--text-primary)]">
                      {quebras.data.itens.map((i) => (
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
                          </td>
                          <td className="py-2 text-right font-medium tabular-nums text-[var(--status-critical)]">
                            {formatInt(i.quebra)} un.
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            {i.valor !== null ? formatMoney(i.valor) : "—"}
                          </td>
                          <td className="py-2 pl-4 text-right tabular-nums text-[var(--text-secondary)]">
                            {formatDayTime(i.ultima)}
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
