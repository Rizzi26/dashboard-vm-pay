"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";

const LINKS = [
  { href: "/", label: "Vendas", roles: ["viewer", "admin", "master"] },
  { href: "/perdidas", label: "Perdas", roles: ["viewer", "admin", "master"] },
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
}: {
  orgName: string;
  role: string;
  email: string | null;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function sair() {
    await supabaseBrowser().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="border-b border-[var(--grid)]">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-3">
        <div className="flex items-center gap-6">
          <span className="text-sm font-semibold text-[var(--text-primary)]">{orgName}</span>
          <nav className="flex gap-4">
            {LINKS.filter((l) => l.roles.includes(role)).map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={
                  pathname === l.href
                    ? "text-sm font-medium text-[var(--text-primary)] underline underline-offset-4"
                    : "text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3 text-xs text-[var(--text-secondary)]">
          <span>
            {email} · {ROLE_LABEL[role] ?? role}
          </span>
          <button
            type="button"
            onClick={sair}
            className="rounded-md border border-[var(--grid)] px-2 py-1 hover:text-[var(--text-primary)]"
          >
            Sair
          </button>
        </div>
      </div>
    </header>
  );
}
