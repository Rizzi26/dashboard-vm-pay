/**
 * Mapa de navegação do painel, num lugar só: a barra do computador, a barra
 * de abas do celular e a tela Mais leem daqui. Os papéis aqui só ESCONDEM
 * link — quem nega acesso é o servidor (require_role), nunca a UI.
 */
export const LINKS = [
  { href: "/", label: "Central", roles: ["viewer", "admin", "master"] },
  { href: "/vendas", label: "Vendas", roles: ["viewer", "admin", "master"] },
  { href: "/prateleira", label: "Prateleira", roles: ["viewer", "admin", "master"] },
  { href: "/reposicao", label: "Reposição", roles: ["viewer", "admin", "master"] },
  { href: "/picklist", label: "Pick list", roles: ["admin", "master"] },
  { href: "/usuarios", label: "Usuários", roles: ["master"] },
  { href: "/auditoria", label: "Auditoria", roles: ["master"] },
];

export const ROLE_LABEL: Record<string, string> = {
  viewer: "leitura",
  admin: "operação",
  master: "master",
};

export type Aba = "central" | "vendas" | "prateleira" | "picklist" | "mais";

/** Seção ativa na barra do computador: a ficha do produto pertence à Prateleira. */
export function linkAtivo(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/prateleira" && pathname.startsWith("/produto")) return true;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Aba ativa no celular. Reposição acende a Central (é de lá que se chega,
 * pelo "O que repor hoje" — CelReposicao da proposta); Usuários e Auditoria
 * moram em Mais.
 */
export function abaAtiva(pathname: string): Aba | null {
  if (pathname === "/" || pathname.startsWith("/reposicao")) return "central";
  if (pathname.startsWith("/vendas")) return "vendas";
  if (pathname.startsWith("/prateleira") || pathname.startsWith("/produto")) return "prateleira";
  if (pathname.startsWith("/picklist")) return "picklist";
  if (pathname.startsWith("/mais") || pathname.startsWith("/usuarios") || pathname.startsWith("/auditoria"))
    return "mais";
  return null;
}

/** Letra do avatar. Fica aqui, e não no MenuConta ("use client"), porque a
 *  tela Mais é componente de servidor e não pode chamar função de cliente. */
export function inicialDe(email: string | null): string {
  return (email?.trim()[0] ?? "?").toUpperCase();
}
