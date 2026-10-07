import type { ReactNode } from "react";

/**
 * Invólucro do conteúdo de uma tela, logo abaixo do Header: largura máxima e
 * gutter da proposta (16px no celular, 24px no computador; 1240px, ou 900px
 * nas telas de leitura como Usuários e Auditoria). A folga para a barra de
 * abas do celular NÃO mora aqui — está no body (globals.css), para valer
 * também nas telas que ainda não usam Pagina.
 */
export function Pagina({
  largura = "normal",
  className = "",
  children,
}: {
  largura?: "normal" | "estreita";
  className?: string;
  children: ReactNode;
}) {
  const max = largura === "estreita" ? "max-w-[900px]" : "max-w-[1240px]";
  return (
    <main
      className={`mx-auto flex w-full ${max} min-w-0 flex-col gap-3.5 px-4 pb-10 pt-3 md:gap-4 md:px-6 md:pb-16 md:pt-10 ${className}`}
    >
      {children}
    </main>
  );
}
