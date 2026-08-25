import { Header } from "@/components/Header";
import { StatTile } from "@/components/StatTile";
import { Offline } from "@/components/Offline";
import { StockView } from "@/components/StockView";
import { serverApi } from "@/lib/api.server";
import { formatInt, formatMoney } from "@/lib/format";
import { orgSession } from "@/lib/org";

export default async function EstoquePage() {
  const { me, org } = await orgSession();
  const stock = await serverApi.stock(org.slug);

  return (
    <div className="viz-root min-h-screen bg-[var(--surface-1)]">
      <Header orgName={org.name} role={org.role} email={me.email} />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <header className="mb-6">
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">Estoque</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Saldo atual por local e produto, sincronizado da VMpay.
          </p>
        </header>
        {stock.ok ? (
          <>
            <ShelfTiles rows={stock.data} />
            <StockView rows={stock.data} org={org.slug} role={org.role} />
          </>
        ) : (
          <Offline error={stock.error} />
        )}
      </main>
    </div>
  );
}

function ShelfTiles({ rows }: { rows: { quantidade: number; preco: number | null }[] }) {
  // Calculado dos dados que a página já carrega — sem endpoint novo.
  const unidades = rows.reduce((s, r) => s + r.quantidade, 0);
  const valor = rows.reduce((s, r) => s + r.quantidade * (r.preco ?? 0), 0);
  const disponiveis = rows.filter((r) => r.quantidade > 0).length;
  const ruptura = rows.filter((r) => r.quantidade === 0).length;
  return (
    <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
      <StatTile label="Unidades em prateleira" value={formatInt(unidades)} />
      <StatTile
        label="Valor de prateleira"
        value={formatMoney(valor)}
        hint="a preço de venda; itens sem preço conhecido ficam de fora"
      />
      <StatTile label="Produtos disponíveis" value={formatInt(disponiveis)} />
      <StatTile
        label="Em ruptura"
        value={formatInt(ruptura)}
        hint="itens do planograma com saldo zero"
      />
    </div>
  );
}
