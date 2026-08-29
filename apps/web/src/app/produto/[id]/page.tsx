import Link from "next/link";

import { Card } from "@/components/Card";
import { Header } from "@/components/Header";
import { Offline } from "@/components/Offline";
import { PeriodoNav } from "@/components/PeriodoNav";
import { RevenueChart } from "@/components/RevenueChart";
import { StatTile } from "@/components/StatTile";
import { StockHistoryChart } from "@/components/StockHistoryChart";
import { serverApi } from "@/lib/api.server";
import { formatDay, formatInt, formatMoney } from "@/lib/format";
import { orgSession } from "@/lib/org";
import { startFor } from "@/lib/periodos";

export default async function ProdutoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ periodo?: string }>;
}) {
  const { me, org } = await orgSession();
  const { id } = await params;
  const { periodo = "30" } = await searchParams;
  // "tudo" vira o teto do endpoint (365): a série começa no deploy do
  // histórico de qualquer jeito, então o teto nunca corta dado real.
  const diasHistorico = Number(periodo) || 365;
  const [detail, historico] = await Promise.all([
    serverApi.product(org.slug, id, `?start=${startFor(periodo)}`),
    serverApi.stockHistory(org.slug, id, diasHistorico),
  ]);

  return (
    <div className="viz-root min-h-screen bg-[var(--surface-0)]">
      <Header orgName={org.name} role={org.role} email={me.email} local={org.local} periodo={periodo} />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
        <Link
          href="/estoque"
          className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          ← Estoque
        </Link>

        {detail.ok ? (
          <>
            <header className="mb-6 mt-2">
              <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
                {detail.data.produto.nome}
              </h1>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">
                {detail.data.produto.barcode ?? "sem código de barras"} ·{" "}
                {formatDay(detail.data.periodo.inicio)} a{" "}
                {formatDay(detail.data.periodo.fim)}
              </p>
              <PeriodoNav basePath={`/produto/${id}`} periodo={periodo} />
            </header>

            <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              <StatTile
                label="Unidades vendidas"
                value={formatInt(detail.data.resumo.unidades)}
              />
              <StatTile
                label="Faturamento"
                value={formatMoney(detail.data.resumo.faturamento)}
              />
              <StatTile
                label="Preço médio praticado"
                value={
                  detail.data.resumo.preco_medio !== null
                    ? formatMoney(detail.data.resumo.preco_medio)
                    : "—"
                }
                hint={
                  detail.data.produto.preco !== null
                    ? `tabela: ${formatMoney(detail.data.produto.preco)}`
                    : undefined
                }
              />
              <StatTile
                label="Em prateleira"
                value={formatInt(detail.data.produto.estoque)}
                tone={detail.data.produto.estoque === 0 ? "critical" : undefined}
                hint={detail.data.produto.estoque === 0 ? "em ruptura" : undefined}
              />
              <StatTile
                label="Última venda"
                value={
                  detail.data.resumo.ultima_venda
                    ? formatDay(detail.data.resumo.ultima_venda.slice(0, 10))
                    : "—"
                }
              />
            </div>

            <div className="mb-6">
              <Link
                href={`/estoque?q=${encodeURIComponent(
                  detail.data.produto.barcode ?? detail.data.produto.nome,
                )}`}
                className="text-sm text-[var(--accent)] underline underline-offset-4"
              >
                Ver no estoque →
              </Link>
            </div>

            <Card
              title="Vendas por dia"
              subtitle="Unidades e faturamento deste produto, pelos /vends."
            >
              <RevenueChart
                points={detail.data.diario.map((d) => ({
                  dia: d.dia,
                  faturamento: d.faturamento,
                  transacoes: d.unidades,
                }))}
                countLabel="unidades"
              />
            </Card>

            {historico.ok ? (
              <div className="mt-6">
                <Card
                  title="Saldo em prateleira"
                  subtitle="Uma amostra por sincronização. Degrau para baixo = saiu produto; para cima = reposição."
                >
                  <StockHistoryChart points={historico.data} />
                </Card>
              </div>
            ) : null}
          </>
        ) : (
          <div className="mt-6">
            <Offline error={detail.error} />
          </div>
        )}
      </main>
    </div>
  );
}
