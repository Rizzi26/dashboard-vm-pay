"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AtualizarDados } from "@/components/AtualizarDados";
import { LojaSelector } from "@/components/LojaSelector";
import { browserApi } from "@/lib/api";
import { supabaseBrowser } from "@/lib/supabase/browser";

const LINKS = [
  { href: "/", label: "Central", roles: ["viewer", "admin", "master"] },
  { href: "/vendas", label: "Vendas", roles: ["viewer", "admin", "master"] },
  { href: "/perdidas", label: "Perdas", roles: ["viewer", "admin", "master"] },
  { href: "/estoque", label: "Estoque", roles: ["viewer", "admin", "master"] },
  { href: "/reposicao", label: "Reposição", roles: ["viewer", "admin", "master"] },
  { href: "/picklist", label: "Pick list", roles: ["admin", "master"] },
  { href: "/usuarios", label: "Usuários", roles: ["master"] },
  { href: "/auditoria", label: "Auditoria", roles: ["master"] },
];

const ROLE_LABEL: Record<string, string> = {
  viewer: "leitura",
  admin: "operação",
  master: "master",
};

export function Header({
  org,
  orgName,
  role,
  email,
  periodo,
  lojas = [],
  loja = null,
}: {
  org: string;
  orgName: string;
  role: string;
  email: string | null;
  periodo?: string;
  lojas?: { id: string; nome: string }[];
  loja?: string | null;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function sair() {
    const supabase = supabaseBrowser();
    // Logout na auditoria ANTES de encerrar: depois não há token para mandar.
    const { data } = await supabase.auth.getSession();
    if (data.session) {
      await browserApi
        .request(`/orgs/${org}/sessao/sair`, data.session.access_token, { method: "POST" })
        .catch(() => undefined);
    }
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  // O período selecionado sobrevive à troca de aba — sem useSearchParams,
  // que exigiria boundary de Suspense: as páginas que o conhecem passam a prop.
  function hrefFor(href: string): string {
    if (periodo && periodo !== "30" && (href === "/vendas" || href === "/perdidas")) {
      return `${href}?periodo=${periodo}`;
    }
    return href;
  }

  return (
    <header className="sticky top-0 z-20 border-b border-[var(--grid)] bg-[var(--surface-0)]">
      {/* Duas linhas: identidade + ações em cima, navegação embaixo. Numa linha
          só, o botão de atualizar empurrava os links por cima do nome. */}
      <div className="mx-auto flex max-w-5xl flex-col gap-1 px-4 py-2 sm:gap-2 sm:px-6 sm:py-3">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <span className="block truncate text-sm font-semibold text-[var(--text-primary)]">
              {orgName}
            </span>
            <LojaSelector lojas={lojas} loja={loja} />
          </div>
          <div className="flex shrink-0 items-center gap-3 text-xs text-[var(--text-secondary)]">
            <AtualizarDados org={org} />
            <span>
              <span className="hidden md:inline">{email} · </span>
              {ROLE_LABEL[role] ?? role}
            </span>
            <button
              type="button"
              onClick={sair}
              className="rounded-lg border border-[var(--grid)] px-3 py-2 hover:bg-[var(--row-hover)] hover:text-[var(--text-primary)]"
            >
              Sair
            </button>
          </div>
        </div>
        <nav className="-mx-4 flex gap-1 overflow-x-auto px-4 sm:-mx-3 sm:gap-2 sm:overflow-visible sm:px-0">
          {LINKS.filter((l) => l.roles.includes(role)).map((l) => {
            const ativo =
              pathname === l.href ||
              (l.href === "/estoque" && pathname.startsWith("/produto"));
            return (
              <Link
                key={l.href}
                href={hrefFor(l.href)}
                className={
                  ativo
                    ? "whitespace-nowrap rounded-md px-3 py-2.5 text-sm font-medium text-[var(--text-primary)] underline decoration-2 decoration-[var(--accent)] underline-offset-4"
                    : "whitespace-nowrap rounded-md px-3 py-2.5 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
