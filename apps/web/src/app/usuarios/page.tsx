import { redirect } from "next/navigation";
import { Header } from "@/components/Header";
import { MembersView } from "@/components/MembersView";
import { Offline } from "@/components/Offline";
import { Pagina } from "@/components/ui/Pagina";
import { Titulo } from "@/components/ui/Titulo";
import { serverApi } from "@/lib/api.server";
import { orgSession } from "@/lib/org";

export default async function UsuariosPage() {
  const { me, org } = await orgSession();
  // O servidor nega de qualquer forma (403); o redirect é só cortesia de UX.
  if (org.role !== "master" && !me.platform_admin) redirect("/");

  const members = await serverApi.members(org.slug);

  return (
    <div className="min-h-screen">
      <Header org={org.slug} orgName={org.name} role={org.role} email={me.email} lojas={org.lojas} loja={org.loja} />
      <Pagina largura="estreita">
        <Titulo sobretitulo={org.name} titulo="Usuários" subtitulo="Quem acessa o painel e o que pode fazer." />
        {members.ok ? (
          <MembersView rows={members.data} org={org.slug} selfId={me.user_id} />
        ) : (
          <Offline error={members.error} />
        )}
      </Pagina>
    </div>
  );
}
