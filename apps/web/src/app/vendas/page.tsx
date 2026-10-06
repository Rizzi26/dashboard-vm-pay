import { Card } from "@/components/Card";
import { MachineTable } from "@/components/MachineTable";
import { Offline } from "@/components/Offline";
import { PeriodoNav } from "@/components/PeriodoNav";
import { RevenueChart } from "@/components/RevenueChart";
import { StatTile } from "@/components/StatTile";
import { SyncStatus } from "@/components/SyncStatus";

import { CurvaAbc } from "@/components/CurvaAbc";
import { Header } from "@/components/Header";
import { VendasHeatmap } from "@/components/VendasHeatmap";
import { serverApi } from "@/lib/api.server";
import { formatDay, formatInt, formatMoney } from "@/lib/format";
import { lojaQs, orgSession } from "@/lib/org";
import { startFor } from "@/lib/periodos";

/** "+12% vs período anterior" — ou nada, quando não há base para comparar. */
function variacao(atual: number, antes: number | undefined): string | null {
  if (antes === undefined || antes <= 0) return null;
  const v = ((atual - antes) / antes) * 100;
  const sinal = v > 0 ? "+" : v < 0 ? "−" : "±";
  return `${sinal}${Math.abs(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}% vs período anterior`;
}

export default async function VendasPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>;
}) {
  const { me, org } = await orgSession();
  const { periodo = "30" } = await searchParams;
  const qs = `?start=${startFor(periodo)}${lojaQs(org.loja)}`;

  // Em paralelo: um bloco lento não segura os outros, e um que falha não
  // derruba a página.
  const [summary, daily, machines, sync, heat, abc] = await Promise.all([
    serverApi.summary(org.slug, qs),
    serverApi.daily(org.slug, qs),
    serverApi.byMachine(org.slug, `${qs}&limit=10`),
    serverApi.syncStatus(org.slug),
    serverApi.heatmap(org.slug, qs),
    serverApi.abc(org.slug, qs),
  ]);
  // "Tudo" não tem período anterior que faça sentido.
  const anterior = periodo !== "tudo" && summary.ok ? summary.data.anterior : undefined;

  return (
    <div className="viz-root min-h-screen bg-[var(--surface-0)]">
      <Header org={org.slug} orgName={org.name} role={org.role} email={me.email} lojas={org.lojas} loja={org.loja} periodo={periodo} />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
          Vendas{org.loja ? ` · ${org.local}` : ""}
        </h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          {summary.ok
            ? `${formatDay(summary.data.periodo.inicio)} a ${formatDay(summary.data.periodo.fim)}`
            : "Últimos 30 dias"}
        </p>
        <PeriodoNav basePath="/vendas" periodo={periodo} />
      </header>

      {summary.ok ? (
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile
            label="Faturamento"
            value={formatMoney(summary.data.faturamento)}
            hint={
              variacao(summary.data.faturamento, anterior?.faturamento) ??
              (summary.data.descontos > 0
                ? `descontos de ${formatMoney(summary.data.descontos)}`
                : "transações confirmadas")
            }
          />
          <StatTile
            label="Transações"
            value={formatInt(summary.data.transacoes)}
            hint={variacao(summary.data.transacoes, anterior?.transacoes) ?? `${formatInt(summary.data.itens)} itens vendidos`}
          />
          <StatTile
            label="Ticket médio"
            value={formatMoney(summary.data.ticket_medio)}
            hint={variacao(summary.data.ticket_medio, anterior?.ticket_medio) ?? undefined}
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

        <Card
          title="Quando a loja vende"
          subtitle="Faturamento por dia da semana e hora, no horário de Brasília — bom para escolher a hora da reposição."
        >
          {heat.ok ? <VendasHeatmap celulas={heat.data.celulas} /> : <Offline error={heat.error} />}
        </Card>

        <Card
          title="Curva ABC"
          subtitle="Produtos por faturamento no período: A faz 80%, B os 15% seguintes, C o resto."
        >
          {abc.ok ? <CurvaAbc dados={abc.data} /> : <Offline error={abc.error} />}
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
