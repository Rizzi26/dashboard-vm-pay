"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AtualizarDados } from "@/components/AtualizarDados";
import { LojaSelector } from "@/components/LojaSelector";
import { AbasInferiores } from "@/components/ui/AbasInferiores";
import { IconeLoja } from "@/components/ui/icones";
import { MenuConta } from "@/components/ui/MenuConta";
import { LINKS, linkAtivo } from "@/components/ui/navegacao";

/**
 * Barra do painel (barra() da proposta). Uma árvore só para os dois tamanhos
 * — LojaSelector e AtualizarDados não duplicam (cada AtualizarDados consulta
 * a API): de md para cima é a pílula de vidro fixa no topo com marca,
 * navegação segmentada e avatar; no celular vira o topo compacto (loja em
 * azul + atualizar), a navegação desce para a barra de abas e a conta vai
 * para a tela Mais. O título grande da tela é da página (ui/Titulo).
 */
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

  // O período selecionado sobrevive à troca de aba — sem useSearchParams,
  // que exigiria boundary de Suspense: as páginas que o conhecem passam a prop.
  function hrefFor(href: string): string {
    if (periodo && periodo !== "30" && href === "/vendas") {
      return `${href}?periodo=${periodo}`;
    }
    return href;
  }

  return (
    <>
      <header
        className="barra-topo relative z-20 mx-auto flex w-full max-w-[1240px] items-center justify-between gap-3 px-4 pt-[max(12px,env(safe-area-inset-top))] md:sticky md:top-4 md:mt-5 md:w-[calc(100%-48px)] md:flex-wrap md:rounded-[22px] md:py-2.5 md:pl-3.5 md:pr-3"
      >
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className="hidden h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] text-white md:flex"
            style={{ background: "var(--marca)" }}
          >
            <IconeLoja tamanho={18} />
          </span>
          <div className="min-w-0">
            {/* No celular o nome da organização só aparece se não houver loja
                para mostrar no lugar (topo_cel mostra só a loja). */}
            <span
              className={`${lojas.length ? "hidden md:block" : "block"} truncate text-[15px] font-semibold tracking-[-0.01em] text-texto`}
            >
              {orgName}
            </span>
            <LojaSelector lojas={lojas} loja={loja} />
          </div>
        </div>

        <nav aria-label="Seções" className="hidden flex-wrap gap-0.5 rounded-[14px] bg-trilho p-[3px] md:flex">
          {LINKS.filter((l) => l.roles.includes(role)).map((l) => {
            const ativo = linkAtivo(l.href, pathname);
            return (
              <Link
                key={l.href}
                href={hrefFor(l.href)}
                aria-current={ativo ? "page" : undefined}
                className={`whitespace-nowrap rounded-[11px] px-[13px] py-[7px] text-[14px] no-underline ${
                  ativo ? "bg-ativo font-semibold text-texto shadow-ativo" : "text-sec hover:text-texto"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          <AtualizarDados org={org} />
          <span className="hidden md:block">
            <MenuConta org={org} orgName={orgName} role={role} email={email} />
          </span>
        </div>
      </header>
      <AbasInferiores role={role} hrefVendas={hrefFor("/vendas")} />
    </>
  );
}
