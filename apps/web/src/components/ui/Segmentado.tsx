"use client";

import Link from "next/link";
import { useRef, type KeyboardEvent, type ReactNode } from "react";

export type OpcaoSegmentado = {
  valor: string;
  rotulo: ReactNode;
  /** Com href, a opção é navegação (período na URL): vira link. */
  href?: string;
};

const TRILHO = "gap-0.5 rounded-xl bg-trilho p-[3px]";
const ITEM =
  "flex min-h-11 items-center justify-center whitespace-nowrap rounded-[9px] px-3.5 text-[13px] no-underline md:min-h-8";
const ITEM_ATIVO = "bg-ativo font-semibold text-texto shadow-ativo";
const ITEM_INATIVO = "text-sec hover:text-texto";

/**
 * Controle segmentado (pílula do item ativo sobre o trilho).
 *
 * Dois modos, porque são dois significados para o leitor de tela:
 * - opções com `href` → <nav> de links com aria-current (troca de página);
 * - sem href → role="radiogroup" com setas do teclado (troca de estado na
 *   mesma tela; precisa de `onMudar`).
 */
export function Segmentado({
  opcoes,
  valor,
  onMudar,
  rotulo,
  largo = false,
  className = "",
}: {
  opcoes: OpcaoSegmentado[];
  valor: string;
  onMudar?: (valor: string) => void;
  /** Nome acessível do grupo ("Período", "Disponibilidade"). */
  rotulo: string;
  /** Ocupa a largura toda, opções iguais (padrão no celular da proposta). */
  largo?: boolean;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const caixa = `${largo ? "flex w-full" : "inline-flex max-w-full overflow-x-auto"} ${TRILHO} ${className}`;
  const flex = largo ? "flex-1" : "";

  if (opcoes.some((o) => o.href)) {
    return (
      <nav aria-label={rotulo} className={caixa}>
        {opcoes.map((o) => {
          const ativo = o.valor === valor;
          return (
            <Link
              key={o.valor}
              href={o.href ?? "#"}
              scroll={false}
              aria-current={ativo ? "page" : undefined}
              className={`${ITEM} ${flex} ${ativo ? ITEM_ATIVO : ITEM_INATIVO}`}
            >
              {o.rotulo}
            </Link>
          );
        })}
      </nav>
    );
  }

  const atual = Math.max(
    0,
    opcoes.findIndex((o) => o.valor === valor),
  );

  // Padrão ARIA de radiogroup: um só item no Tab, setas movem e selecionam.
  function teclas(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const passo =
      e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!passo) return;
    e.preventDefault();
    const prox = (i + passo + opcoes.length) % opcoes.length;
    onMudar?.(opcoes[prox].valor);
    refs.current[prox]?.focus();
  }

  return (
    <div role="radiogroup" aria-label={rotulo} className={caixa}>
      {opcoes.map((o, i) => {
        const ativo = i === atual;
        return (
          <button
            key={o.valor}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={ativo}
            tabIndex={ativo ? 0 : -1}
            onClick={() => onMudar?.(o.valor)}
            onKeyDown={(e) => teclas(e, i)}
            className={`${ITEM} ${flex} border-0 ${ativo ? ITEM_ATIVO : `bg-transparent ${ITEM_INATIVO}`}`}
          >
            {o.rotulo}
          </button>
        );
      })}
    </div>
  );
}
