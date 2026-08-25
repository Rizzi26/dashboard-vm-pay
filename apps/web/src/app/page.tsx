import { Card } from "@/components/Card";
import { MachineTable } from "@/components/MachineTable";
import { Offline } from "@/components/Offline";
import { RevenueChart } from "@/components/RevenueChart";
import { StatTile } from "@/components/StatTile";
import { SyncStatus } from "@/components/SyncStatus";
import Link from "next/link";

import { Header } from "@/components/Header";
import { serverApi } from "@/lib/api.server";
import { formatInt, formatMoney } from "@/lib/format";
import { orgSession } from "@/lib/org";
import { PERIODOS, startFor } from "@/lib/periodos";

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>;
}) {
  const { me, org } = await orgSession();
  const { periodo = "30" } = await searchParams;
  const qs = `?start=${startFor(periodo)}`;

  // Em paralelo: um bloco lento não segura os outros, e um que falha não
  // derruba a página.
  const [summary, daily, machines, sync] = await Promise.all([
    serverApi.summary(org.slug, qs),
    serverApi.daily(org.slug, qs),
    serverApi.byMachine(org.slug, `${qs}&limit=10`),
    serverApi.syncStatus(org.slug),
  ]);

  return (
    <div className="viz-root min-h-screen bg-[var(--surface-1)]">
      <Header orgName={org.name} role={org.role} email={me.email} />
      <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">
          Vendas
        </h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          {summary.ok
            ? `${summary.data.periodo.inicio} a ${summary.data.periodo.fim}`
            : "Últimos 30 dias"}
        </p>
        <nav className="mt-3 flex gap-2">
          {PERIODOS.map((p) => (
            <Link
              key={p.key}
              href={p.key === "30" ? "/" : `/?periodo=${p.key}`}
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

      {summary.ok ? (
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile
            label="Faturamento"
            value={formatMoney(summary.data.faturamento)}
            hint="transações confirmadas"
          />
          <StatTile
            label="Transações"
            value={formatInt(summary.data.transacoes)}
          />
          <StatTile
            label="Ticket médio"
            value={formatMoney(summary.data.ticket_medio)}
          />
          <StatTile
            label="Máquinas ativas"
            value={formatInt(summary.data.maquinas_ativas)}
          />
        </div>
      ) : (
        <div className="mb-6">
          <Offline error={summary.error} />
        </div>
      )}

      <div className="space-y-6">
        <Card
          title="Faturamento por dia"
          subtitle="Só transações com status OK — canceladas não entram."
        >
          {daily.ok ? (
            <RevenueChart points={daily.data} />
          ) : (
            <Offline error={daily.error} />
          )}
        </Card>

        <Card title="Máquinas" subtitle="Top 10 por faturamento no período">
          {machines.ok ? (
            <MachineTable rows={machines.data} />
          ) : (
            <Offline error={machines.error} />
          )}
        </Card>
      </div>

      <footer className="mt-8 border-t border-[var(--grid)] pt-4">
        {sync.ok ? (
          <SyncStatus rows={sync.data} />
        ) : (
          <p className="text-xs text-[var(--text-secondary)]">
            Sem informação de sincronização — {sync.error}
          </p>
        )}
      </footer>
      </main>
    </div>
  );
}
