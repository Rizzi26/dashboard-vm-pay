"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconeLoja, IconeMais, IconePickList, IconePrateleira, IconeVendas } from "./icones";
import { abaAtiva, type Aba } from "./navegacao";

const ABAS: { aba: Aba; href: string; label: string; Icone: typeof IconeLoja; roles?: string[] }[] = [
  { aba: "central", href: "/", label: "Central", Icone: IconeLoja },
  { aba: "vendas", href: "/vendas", label: "Vendas", Icone: IconeVendas },
  { aba: "prateleira", href: "/prateleira", label: "Prateleira", Icone: IconePrateleira },
  { aba: "picklist", href: "/picklist", label: "Pick list", Icone: IconePickList, roles: ["admin", "master"] },
  { aba: "mais", href: "/mais", label: "Mais", Icone: IconeMais },
];

/**
 * Barra de abas de vidro do celular (abas() da proposta). Some de md para
 * cima, onde a navegação é a da barra do topo. A classe `abas-inferiores` é
 * o gancho do globals.css que dá folga no fim do body — não renomeie.
 */
export function AbasInferiores({ role, hrefVendas = "/vendas" }: { role: string; hrefVendas?: string }) {
  const pathname = usePathname();
  const ativa = abaAtiva(pathname);
  return (
    <nav
      aria-label="Seções"
      className="abas-inferiores vidro-forte fixed inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] z-30 flex justify-around rounded-[26px] px-1.5 py-2 md:hidden"
    >
      {ABAS.filter((a) => !a.roles || a.roles.includes(role)).map(({ aba, href, label, Icone }) => {
        const atual = aba === ativa;
        return (
          <Link
            key={aba}
            href={aba === "vendas" ? hrefVendas : href}
            aria-current={atual ? "page" : undefined}
            className={`flex min-h-12 min-w-[58px] flex-col items-center justify-center gap-[3px] rounded-[18px] px-1 py-1.5 text-[11px] no-underline ${
              atual ? "bg-azul-tinta font-semibold text-azul-texto" : "text-sec"
            }`}
          >
            <Icone tamanho={22} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
