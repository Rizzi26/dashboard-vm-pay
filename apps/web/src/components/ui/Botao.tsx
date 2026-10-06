import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";

export type VarianteBotao = "cheio" | "tingido" | "texto" | "perigo";
export type TamanhoBotao = "p" | "m" | "g";

const VARIANTES: Record<VarianteBotao, string> = {
  cheio: "bg-azul-cheio text-sobre-azul font-semibold hover:brightness-110",
  tingido: "bg-azul-tinta text-azul-texto font-medium hover:brightness-95",
  texto: "bg-transparent text-azul-texto hover:bg-azul-tinta",
  perigo: "bg-vermelho-fundo text-vermelho-texto font-medium hover:brightness-95",
};

// No celular nenhum alvo fica abaixo de 44px (h-11); a altura da proposta
// (34/40) só vale de md para cima, onde há mouse.
const TAMANHOS: Record<TamanhoBotao, string> = {
  p: "h-11 px-4 text-[14px] md:h-[34px] md:px-3.5",
  m: "h-11 px-[18px] text-[15px] md:h-10 md:px-4",
  g: "h-[50px] px-5 text-[17px] rounded-[14px]",
};

type Comum = {
  variante?: VarianteBotao;
  tamanho?: TamanhoBotao;
  /** Ocupa a largura toda (botão principal de rodapé no celular). */
  largo?: boolean;
  icone?: ReactNode;
  className?: string;
  children?: ReactNode;
};

type ComoBotao = Comum & ButtonHTMLAttributes<HTMLButtonElement> & { href?: undefined };
type ComoLink = Comum & Omit<ComponentProps<typeof Link>, "className" | "children"> & { href: string };

export function classesBotao({
  variante = "tingido",
  tamanho = "m",
  largo = false,
}: Pick<Comum, "variante" | "tamanho" | "largo"> = {}): string {
  return [
    "inline-flex items-center justify-center gap-1.5 whitespace-nowrap border-0 no-underline",
    "disabled:opacity-50 disabled:pointer-events-none aria-disabled:opacity-50 aria-disabled:pointer-events-none",
    tamanho === "g" ? "" : "rounded-full",
    VARIANTES[variante],
    TAMANHOS[tamanho],
    largo ? "w-full" : "",
  ].join(" ");
}

/**
 * Botão da proposta. Com `href` vira Link do Next (navegação continua sendo
 * link para o leitor de tela e para o "abrir em nova aba").
 */
export function Botao(props: ComoBotao | ComoLink) {
  const { variante, tamanho, largo, icone, className = "", children, ...resto } = props;
  const classes = `${classesBotao({ variante, tamanho, largo })} ${className}`;
  const conteudo = (
    <>
      {icone}
      {children}
    </>
  );
  if (typeof resto.href === "string") {
    return (
      <Link {...(resto as Omit<ComoLink, keyof Comum>)} className={classes}>
        {conteudo}
      </Link>
    );
  }
  const { type = "button", ...botao } = resto as Omit<ComoBotao, keyof Comum>;
  return (
    <button type={type} {...botao} className={classes}>
      {conteudo}
    </button>
  );
}
