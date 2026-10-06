import { redirect } from "next/navigation";
import { Header } from "@/components/Header";
import { Offline } from "@/components/Offline";
import { PickListView } from "@/components/PickListView";
import { Pagina } from "@/components/ui/Pagina";
import { Titulo } from "@/components/ui/Titulo";
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
    <div className="min-h-screen">
      <Header org={org.slug} orgName={org.name} role={org.role} email={me.email} lojas={org.lojas} loja={org.loja} />
      <Pagina>
        {/* O título mora na view: ao abrir um cupom ele vira o fornecedor. */}
        {opcoes.ok ? (
          <PickListView
            org={org.slug}
            opcoes={opcoes.data}
            historico={historico.ok ? historico.data : []}
          />
        ) : (
          <>
            <Titulo titulo="Pick list" />
            <Offline error={opcoes.error} />
          </>
        )}
      </Pagina>
    </div>
  );
}
