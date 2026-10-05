import { redirect } from "next/navigation";
import { Header } from "@/components/Header";
import { Offline } from "@/components/Offline";
import { PickListView } from "@/components/PickListView";
import { serverApi } from "@/lib/api.server";
import { orgSession } from "@/lib/org";

export default async function PickListPage() {
  const { me, org } = await orgSession();
  // O servidor nega de qualquer forma (403); o redirect é só cortesia de UX.
  if (org.role === "viewer" && !me.platform_admin) redirect("/");

  const [opcoes, historico] = await Promise.all([
    serverApi.picklistOpcoes(org.slug),
    serverApi.picklistHistorico(org.slug),
  ]);

  return (
    <div className="viz-root min-h-screen bg-[var(--surface-0)]">
      <Header orgName={org.name} role={org.role} email={me.email} local={org.local} />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">Pick list</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Entrada de estoque pelo cupom fiscal da compra: leia o QR Code, confira e aprove.
          </p>
        </header>
        {opcoes.ok ? (
          <PickListView
            org={org.slug}
            opcoes={opcoes.data}
            historico={historico.ok ? historico.data : []}
          />
        ) : (
          <Offline error={opcoes.error} />
        )}
      </main>
    </div>
  );
}
