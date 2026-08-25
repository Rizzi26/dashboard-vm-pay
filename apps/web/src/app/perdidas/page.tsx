import Link from "next/link";

import { Card } from "@/components/Card";
import { Header } from "@/components/Header";
import { Offline } from "@/components/Offline";
import { StatTile } from "@/components/StatTile";
import { serverApi } from "@/lib/api.server";
import { formatInt, formatMoney } from "@/lib/format";
import { orgSession } from "@/lib/org";
import { PERIODOS, startFor } from "@/lib/periodos";

export default async function PerdidasPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>;
}) {
  const { me, org } = await orgSession();
  const { periodo = "30" } = await searchParams;
  const lost = await serverApi.lost(org.slug, `?start=${startFor(periodo)}`);

  return (
    <div className="viz-root min-h-screen bg-[var(--surface-1)]">
      <Header orgName={org.name} role={org.role} email={me.email} />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <header className="mb-6">
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">
            Vendas perdidas
          </h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Interações do totem que não viraram dinheiro — cartão recusado,
            operação cancelada, erro de leitura.
          </p>
          <nav className="mt-3 flex gap-2">
            {PERIODOS.map((p) => (
              <Link
                key={p.key}
                href={p.key === "30" ? "/perdidas" : `/perdidas?periodo=${p.key}`}
                className={
                  p.key === periodo
                    ? "rounded-md bg-[var(--series-1)] px-3 py-1 text-sm font-medium text-white"
                    : "rounded-md border border-[var(--grid)] px-3 py-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }
              >
                {p.label}
              </Link>
            ))}
          </nav>
        </header>

        {lost.ok ? (
          <>
            <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatTile
                label="Tentativas não aprovadas"
                value={formatInt(lost.data.tentativas)}
                hint={`de ${formatInt(lost.data.interacoes)} interações`}
              />
              <StatTile
                label="Taxa de recusa"
                value={`${(lost.data.taxa * 100).toFixed(1)}%`}
              />
              <StatTile
                label="Valor não capturado"
                value={formatMoney(lost.data.valor_nao_capturado)}
                hint="teto — o cliente pode ter tentado de novo e comprado"
              />
            </div>

            <Card
              title="Motivos"
              subtitle="Como a VMpay descreve cada tentativa não aprovada."
            >
              {lost.data.motivos.length === 0 ? (
                <p className="py-8 text-center text-sm text-[var(--text-secondary)]">
                  Nenhuma tentativa não aprovada no período. 🎉
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase text-[var(--text-secondary)]">
                      <th className="py-2 font-medium">Motivo</th>
                      <th className="py-2 text-right font-medium">Tentativas</th>
                      <th className="py-2 text-right font-medium">Valor</th>
                    </tr>
                  </thead>
                  <tbody className="text-[var(--text-primary)]">
                    {lost.data.motivos.map((m) => (
                      <tr key={m.motivo} className="border-t border-[var(--grid)]">
                        <td className="py-2">{m.motivo}</td>
                        <td className="py-2 text-right tabular-nums">
                          {formatInt(m.tentativas)}
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {formatMoney(m.valor)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </>
        ) : (
          <Offline error={lost.error} />
        )}
      </main>
    </div>
  );
}
