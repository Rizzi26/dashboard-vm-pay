import { Card } from "@/components/Card";
import { MachineTable } from "@/components/MachineTable";
import { Offline } from "@/components/Offline";
import { RevenueChart } from "@/components/RevenueChart";
import { StatTile } from "@/components/StatTile";
import { SyncStatus } from "@/components/SyncStatus";
import { api } from "@/lib/api";
import { formatInt, formatMoney } from "@/lib/format";

export default async function Dashboard() {
  // Em paralelo: um bloco lento não segura os outros, e um que falha não
  // derruba a página.
  const [summary, daily, machines, sync] = await Promise.all([
    api.summary(),
    api.daily(),
    api.byMachine("?limit=10"),
    api.syncStatus(),
  ]);

  return (
    <main className="viz-root mx-auto max-w-5xl bg-[var(--surface-1)] px-6 py-10">
      <header className="mb-8">
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">
          VMpay · Vendas
        </h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          {summary.ok
            ? `${summary.data.periodo.inicio} a ${summary.data.periodo.fim}`
            : "Últimos 30 dias"}
        </p>
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
  );
}
