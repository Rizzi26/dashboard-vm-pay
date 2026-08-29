"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

const LINKS = [
  { href: "/", label: "Vendas", roles: ["viewer", "admin", "master"] },
  { href: "/perdidas", label: "Perdas", roles: ["viewer", "admin", "master"] },
  { href: "/quebras", label: "Quebras", roles: ["viewer", "admin", "master"] },
  { href: "/estoque", label: "Estoque", roles: ["viewer", "admin", "master"] },
  { href: "/usuarios", label: "Usuários", roles: ["master"] },
];

const ROLE_LABEL: Record<string, string> = {
  viewer: "leitura",
  admin: "operação",
  master: "master",
};

export function Header({
  orgName,
  role,
  email,
  periodo,
  local,
}: {
  orgName: string;
  role: string;
  email: string | null;
  periodo?: string;
  local?: string | null;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function sair() {
    await supabaseBrowser().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  // O período selecionado sobrevive à troca de aba — sem useSearchParams,
  // que exigiria boundary de Suspense: as páginas que o conhecem passam a prop.
  function hrefFor(href: string): string {
    if (periodo && periodo !== "30" && (href === "/" || href === "/perdidas")) {
      return href === "/" ? `/?periodo=${periodo}` : `${href}?periodo=${periodo}`;
    }
    return href;
  }

  return (
    <header className="sticky top-0 z-20 border-b border-[var(--grid)] bg-[var(--surface-0)]">
      <div className="mx-auto flex max-w-5xl flex-col gap-1 px-4 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-6 sm:py-3">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <span className="block truncate text-sm font-semibold text-[var(--text-primary)]">
              {orgName}
            </span>
            {local ? (
              <span className="block truncate text-[11px] leading-tight text-[var(--text-secondary)]">
                {local}
              </span>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-3 text-xs text-[var(--text-secondary)]">
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
        <nav className="-mx-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:gap-2 sm:overflow-visible sm:px-0">
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
