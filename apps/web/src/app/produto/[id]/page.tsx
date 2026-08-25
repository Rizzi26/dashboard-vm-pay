import Link from "next/link";

import { Card } from "@/components/Card";
import { Header } from "@/components/Header";
import { Offline } from "@/components/Offline";
import { RevenueChart } from "@/components/RevenueChart";
import { StatTile } from "@/components/StatTile";
import { serverApi } from "@/lib/api.server";
import { formatDay, formatInt, formatMoney } from "@/lib/format";
import { orgSession } from "@/lib/org";
import { PERIODOS, startFor } from "@/lib/periodos";

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
  const detail = await serverApi.product(org.slug, id, `?start=${startFor(periodo)}`);

  return (
    <div className="viz-root min-h-screen bg-[var(--surface-1)]">
      <Header orgName={org.name} role={org.role} email={me.email} />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <Link
          href="/estoque"
          className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          ← Estoque
        </Link>

        {detail.ok ? (
          <>
            <header className="mb-6 mt-2">
              <h1 className="text-xl font-semibold text-[var(--text-primary)]">
                {detail.data.produto.nome}
              </h1>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">
                {detail.data.produto.barcode ?? "sem código de barras"} ·{" "}
                {detail.data.periodo.inicio} a {detail.data.periodo.fim}
              </p>
              <nav className="mt-3 flex gap-2">
                {PERIODOS.map((p) => (
                  <Link
                    key={p.key}
                    href={
                      p.key === "30"
                        ? `/produto/${id}`
                        : `/produto/${id}?periodo=${p.key}`
                    }
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

            <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
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
