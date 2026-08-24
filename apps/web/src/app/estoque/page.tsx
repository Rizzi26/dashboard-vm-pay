import { Header } from "@/components/Header";
import { Offline } from "@/components/Offline";
import { StockView } from "@/components/StockView";
import { serverApi } from "@/lib/api.server";
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
          <StockView rows={stock.data} org={org.slug} role={org.role} />
        ) : (
          <Offline error={stock.error} />
        )}
      </main>
    </div>
  );
}
