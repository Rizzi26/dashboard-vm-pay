import Link from "next/link";
import type { ReactNode } from "react";
import { Chevron } from "./icones";

/**
 * Lista agrupada estilo iOS (lista() da proposta). É a forma das tabelas no
 * celular: cada linha vira LinhaLista com principal/secundário à esquerda e
 * o número à direita. O separador sai do CSS (li + li), para nenhuma linha
 * precisar saber se é a primeira.
 */
export function Lista({
  como: Tag = "ul",
  rotulo,
  className = "",
  children,
}: {
  como?: "ul" | "ol";
  /** aria-label, quando a lista não tem CabecalhoLista visível antes. */
  rotulo?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tag
      aria-label={rotulo}
      className={`vidro-lista m-0 list-none overflow-hidden rounded-2xl p-0 [&>li+li]:border-t [&>li+li]:border-sep ${className}`}
    >
      {children}
    </Tag>
  );
}

/**
 * Uma linha da Lista. Com `href`, a linha inteira é o alvo do toque (e o
 * chevron aparece sozinho); sem href, `chevron` força. `esquerda` é ícone,
 * avatar, checkbox ou selo; `direita` é o valor.
 */
export function LinhaLista({
  principal,
  secundario,
  esquerda,
  direita,
  href,
  chevron,
  className = "",
}: {
  principal: ReactNode;
  secundario?: ReactNode;
  esquerda?: ReactNode;
  direita?: ReactNode;
  href?: string;
  chevron?: boolean;
  className?: string;
}) {
  const mostraChevron = chevron ?? Boolean(href);
  const corpo = (
    <>
      {esquerda ? <span className="flex shrink-0 items-center">{esquerda}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="block break-words text-[16px] text-texto md:text-[15px]">{principal}</span>
        {secundario ? <span className="block text-[13px] text-sec">{secundario}</span> : null}
      </span>
      {direita ? <span className="flex shrink-0 items-center gap-1.5 text-right">{direita}</span> : null}
      {mostraChevron ? <Chevron /> : null}
    </>
  );
  const pad = "flex min-h-11 items-center gap-3 px-4 py-[13px]";
  return (
    <li className={href ? className : `${pad} ${className}`}>
      {href ? (
        <Link href={href} className={`${pad} text-texto no-underline hover:bg-[var(--row-hover)]`}>
          {corpo}
        </Link>
      ) : (
        corpo
      )}
    </li>
  );
}

/** Rótulo em caixa alta acima de uma Lista (cab_lista() da proposta). */
export function CabecalhoLista({
  tom = "sec",
  acao,
  className = "",
  children,
}: {
  tom?: "sec" | "vermelho" | "laranja";
  /** Link/botão pequeno à direita ("Ver tudo"). */
  acao?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const cor = tom === "vermelho" ? "text-vermelho-texto" : tom === "laranja" ? "text-laranja-texto" : "text-sec";
  return (
    <div className={`mx-4 mt-1.5 flex items-baseline justify-between gap-3 ${className}`}>
      <h2 className={`m-0 text-[13px] font-semibold uppercase tracking-[0.04em] ${cor}`}>{children}</h2>
      {acao}
    </div>
  );
}
