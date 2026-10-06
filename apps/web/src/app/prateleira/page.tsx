import Link from "next/link";
import { EncalheView } from "@/components/EncalheView";
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

export default async function PrateleiraPage({
  searchParams,
}: {
  searchParams: Promise<{ disp?: string; q?: string; ver?: string }>;
}) {
  const { me, org } = await orgSession();
  const { disp, q, ver } = await searchParams;
  const aba = ver === "encalhe" ? "encalhe" : "saldo";
  const initialDisp = disp === "com" || disp === "sem" ? disp : undefined;
  const [todos, encalhe] = await Promise.all([
    serverApi.stock(org.slug),
    serverApi.encalhe(org.slug, org.loja ? `?loja=${org.loja}` : ""),
  ]);
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
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">Prateleira</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            O que está exposto em cada loja agora
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
          <nav aria-label="Visão" className="mt-3 inline-flex rounded-lg border border-[var(--grid)] bg-[var(--surface-0)] p-0.5">
            {[
              { key: "saldo", label: "Saldo", href: "/prateleira" },
              {
                key: "encalhe",
                label: `Encalhados${encalhe.ok ? ` (${encalhe.data.resumo.itens})` : ""}`,
                href: "/prateleira?ver=encalhe",
              },
            ].map((t) => (
              <Link
                key={t.key}
                href={t.href}
                className={
                  t.key === aba
                    ? "flex min-h-11 items-center rounded-md bg-[var(--surface-1)] px-3 text-sm font-medium text-[var(--text-primary)] shadow-[var(--shadow-card)]"
                    : "flex min-h-11 items-center rounded-md px-3 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }
              >
                {t.label}
              </Link>
            ))}
          </nav>
        </header>
        {aba === "encalhe" ? (
          encalhe.ok ? (
            <EncalheView dados={encalhe.data} />
          ) : (
            <Offline error={encalhe.error} />
          )
        ) : stock.ok ? (
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
