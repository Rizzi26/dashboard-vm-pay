import { ContasVmpay } from "@/components/ContasVmpay";
import { Header } from "@/components/Header";
import { LojaCards } from "@/components/LojaCards";
import { Offline } from "@/components/Offline";
import { StatTile } from "@/components/StatTile";
import { serverApi } from "@/lib/api.server";
import { formatInt, formatMoney } from "@/lib/format";
import { orgSession } from "@/lib/org";

/**
 * Central das lojas: a primeira tela. O lojista é a organização; cada
 * mercadinho dele é uma loja. Daqui se vê qual loja pede atenção e se entra
 * nela — a loja escolhida passa a valer em Vendas, Estoque e Reposição.
 */
export default async function CentralPage() {
  const { me, org } = await orgSession();
  const ehMaster = org.role === "master" || me.platform_admin;
  // Contas só para master: é ele quem conecta loja nova (o servidor nega a quem não for).
  const [central, contas] = await Promise.all([
    serverApi.lojas(org.slug),
    ehMaster ? serverApi.contas(org.slug) : Promise.resolve(null),
  ]);

  return (
    <div className="viz-root min-h-screen bg-[var(--surface-0)]">
      <Header org={org.slug} orgName={org.name} role={org.role} email={me.email} lojas={org.lojas} loja={org.loja} />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
            Central das lojas
          </h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            {org.name} · {org.lojas.length} loja{org.lojas.length === 1 ? "" : "s"}
          </p>
        </header>

        {!central.ok ? (
          <Offline error={central.error} />
        ) : central.data.lojas.length === 0 ? (
          <p className="rounded-md border border-dashed border-[var(--grid)] p-8 text-center text-sm text-[var(--text-secondary)]">
            Nenhuma loja ainda. Cada máquina instalada na VMpay vira uma loja aqui — ela
            aparece na próxima atualização dos dados.
          </p>
        ) : (
          <>
            {central.data.lojas.length > 1 ? (
              <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
                <StatTile label="Hoje · todas" value={formatMoney(central.data.totais.hoje)} />
                <StatTile label="7 dias" value={formatMoney(central.data.totais.d7)} />
                <StatTile label="30 dias" value={formatMoney(central.data.totais.d30)} />
                <StatTile
                  label="Itens zerados"
                  value={formatInt(central.data.totais.zerados)}
                  hint={`${formatInt(central.data.totais.acabando)} acabando`}
                  tone={central.data.totais.zerados > 0 ? "warning" : undefined}
                />
              </div>
            ) : null}
            <LojaCards lojas={central.data.lojas} />
          </>
        )}
        {contas?.ok ? <ContasVmpay org={org.slug} contas={contas.data} /> : null}
      </main>
    </div>
  );
}
