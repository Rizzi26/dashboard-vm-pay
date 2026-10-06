import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { serverApi } from "@/lib/api.server";
import type { Me } from "@/lib/api";

/** Cookie da loja escolhida na barra. Vale em todas as telas da organização. */
export const LOJA_COOKIE = "loja";

export type Loja = { id: string; nome: string };

export type OrgSession = {
  me: Me;
  org: {
    slug: string;
    name: string;
    role: string;
    /** Rótulo do ponto físico no header: a loja escolhida, a única, ou "N lojas". */
    local: string | null;
    lojas: Loja[];
    /** Loja escolhida (id) ou null = todas. */
    loja: string | null;
  };
};

/**
 * Resolve a organização ativa do usuário logado e a loja escolhida.
 *
 * Organização: a primeira da lista (cada lojista é uma organização; quem
 * participa de mais de uma ganha um seletor quando existir o caso). Loja: o
 * cookie da barra — validado contra as lojas DESTA organização, para um id
 * de outro lojista nunca virar filtro.
 */
export async function orgSession(): Promise<OrgSession> {
  const me = await serverApi.me();
  if (!me.ok) redirect("/login");
  const first = me.data.organizations[0];
  if (!first) {
    // Autenticado mas sem organização: convite incompleto ou seed pendente.
    redirect("/login?erro=sem-organizacao");
  }
  const lojas = first.lojas ?? [];
  const escolhida = (await cookies()).get(LOJA_COOKIE)?.value;
  const loja = lojas.some((l) => l.id === escolhida) ? escolhida! : null;
  const local =
    lojas.find((l) => l.id === loja)?.nome ??
    (lojas.length === 1 ? lojas[0].nome : lojas.length > 1 ? `${lojas.length} lojas` : null);
  return {
    me: me.data,
    org: { slug: first.slug, name: first.name, role: first.role, local, lojas, loja },
  };
}

/** `&loja=…` para as rotas que filtram por loja; vazio quando é "todas". */
export function lojaQs(loja: string | null): string {
  return loja ? `&loja=${loja}` : "";
}
