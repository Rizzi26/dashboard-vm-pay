import { redirect } from "next/navigation";
import { serverApi } from "@/lib/api.server";
import type { Me } from "@/lib/api";

export type OrgSession = {
  me: Me;
  org: { slug: string; name: string; role: string };
};

/**
 * Resolve a organização ativa do usuário logado.
 *
 * PoC de organização única: a primeira da lista. Quando houver mais de uma,
 * isto vira um seletor persistido — o resto do app já recebe {slug, role} e não
 * muda.
 */
export async function orgSession(): Promise<OrgSession> {
  const me = await serverApi.me();
  if (!me.ok) redirect("/login");
  const first = me.data.organizations[0];
  if (!first) {
    // Autenticado mas sem organização: convite incompleto ou seed pendente.
    redirect("/login?erro=sem-organizacao");
  }
  return { me: me.data, org: first };
}
