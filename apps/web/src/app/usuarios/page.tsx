import { redirect } from "next/navigation";
import { Header } from "@/components/Header";
import { MembersView } from "@/components/MembersView";
import { Offline } from "@/components/Offline";
import { serverApi } from "@/lib/api.server";
import { orgSession } from "@/lib/org";

export default async function UsuariosPage() {
  const { me, org } = await orgSession();
  // O servidor nega de qualquer forma (403); o redirect é só cortesia de UX.
  if (org.role !== "master" && !me.platform_admin) redirect("/");

  const members = await serverApi.members(org.slug);

  return (
    <div className="viz-root min-h-screen bg-[var(--surface-0)]">
      <Header orgName={org.name} role={org.role} email={me.email} />
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">Usuários</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Quem acessa o painel de {org.name} e com qual papel.
          </p>
        </header>
        {members.ok ? (
          <MembersView rows={members.data} org={org.slug} selfId={me.user_id} />
        ) : (
          <Offline error={members.error} />
        )}
      </main>
    </div>
  );
}
