import { Header } from "@/components/Header";
import { Offline } from "@/components/Offline";
import { StockView } from "@/components/StockView";
import { serverApi } from "@/lib/api.server";
import { formatAtraso } from "@/lib/format";
import { orgSession } from "@/lib/org";

/**
 * Frescor do dado: o operador decide reposição sobre este saldo — se ele
 * está velho, precisa saber antes de sair carregando caixa. Fora do corpo do
 * componente porque numa página dinâmica de servidor cada request é um render
 * novo — o "agora" é estável dentro do request.
 */
function atrasoDoEstoque(rows: { atualizado_em: string }[]): number | null {
  if (rows.length === 0) return null;
  const maisRecente = Math.max(...rows.map((r) => Date.parse(r.atualizado_em)));
  if (Number.isNaN(maisRecente)) return null;
  return Math.max(0, Math.floor((Date.now() - maisRecente) / 1000));
}

export default async function EstoquePage({
  searchParams,
}: {
  searchParams: Promise<{ disp?: string; q?: string }>;
}) {
  const { me, org } = await orgSession();
  const { disp, q } = await searchParams;
  const initialDisp = disp === "com" || disp === "sem" ? disp : undefined;
  const todos = await serverApi.stock(org.slug);
  // Loja escolhida na barra: só os saldos dela.
  const stock = todos.ok && org.loja
    ? { ...todos, data: todos.data.filter((r) => r.location_id === org.loja) }
    : todos;

  const atrasoSeg = stock.ok ? atrasoDoEstoque(stock.data) : null;

  return (
    <div className="viz-root min-h-screen bg-[var(--surface-0)]">
      <Header org={org.slug} orgName={org.name} role={org.role} email={me.email} lojas={org.lojas} loja={org.loja} />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">Estoque</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Saldo atual por local e produto
            {atrasoSeg !== null ? (
              atrasoSeg > 9 * 3600 ? (
                <>
                  {" — "}
                  <span className="text-[var(--status-warning)]">
                    ▲ sincronizado {formatAtraso(atrasoSeg)}
                  </span>
                </>
              ) : (
                <> — sincronizado {formatAtraso(atrasoSeg)}</>
              )
            ) : null}
            .
          </p>
        </header>
        {stock.ok ? (
          <StockView
            rows={stock.data}
            org={org.slug}
            role={org.role}
            initialDisp={initialDisp}
            initialBusca={q}
            loja={org.loja}
          />
        ) : (
          <Offline error={stock.error} />
        )}
      </main>
    </div>
  );
}
