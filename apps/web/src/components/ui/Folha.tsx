"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";

const FOCAVEIS =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Campo de formulário da proposta — o mesmo nas folhas e fora delas. */
export const CAMPO =
  "mt-1.5 block h-12 w-full rounded-xl border border-campo-borda bg-campo px-3.5 text-[17px] text-texto outline-none focus:border-azul md:h-11 md:text-[16px]";
export const ROTULO_CAMPO = "block text-[13px] text-sec";

/**
 * Modal da proposta ("Modal que sobe de baixo", componentes()): no celular é
 * uma folha presa ao rodapé, com a alça; de md para cima, diálogo centralizado.
 * Prende o foco dentro dela, fecha com Esc e devolve o foco a quem a abriu —
 * sem isso o Tab escapa para a página por trás do véu. Clicar no véu NÃO
 * fecha: perderia um formulário meio preenchido num toque errado.
 * Com `onSubmit`, a própria folha é o <form> (Enter confirma).
 */
export function Folha({
  titulo,
  subtitulo,
  onFechar,
  onSubmit,
  largura = "md:max-w-[420px]",
  children,
}: {
  titulo: ReactNode;
  subtitulo?: ReactNode;
  onFechar: () => void;
  onSubmit?: (e: FormEvent<HTMLFormElement>) => void;
  /** Classe literal com o prefixo md: (o Tailwind só enxerga texto inteiro). */
  largura?: string;
  children: ReactNode;
}) {
  const idTitulo = useId();
  const painel = useRef<HTMLElement | null>(null);
  // Quem abriu a folha, lido no render: no efeito já é tarde — o autoFocus
  // do React move o foco para o campo antes de qualquer useEffect rodar.
  const [anterior] = useState(() =>
    typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null),
  );
  // Ref para o Esc sempre chamar o onFechar atual sem reinstalar o efeito
  // (reinstalar devolveria e roubaria o foco a cada render do pai).
  const fechar = useRef(onFechar);
  useEffect(() => {
    fechar.current = onFechar;
  }, [onFechar]);

  useEffect(() => {
    const el = painel.current;
    if (el && !el.contains(document.activeElement)) {
      (el.querySelector<HTMLElement>(FOCAVEIS) ?? el).focus();
    }
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function teclas(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        fechar.current();
        return;
      }
      if (e.key !== "Tab" || !el) return;
      const itens = Array.from(el.querySelectorAll<HTMLElement>(FOCAVEIS)).filter((n) => n.offsetParent !== null);
      if (itens.length === 0) {
        e.preventDefault();
        return;
      }
      const primeiro = itens[0];
      const ultimo = itens[itens.length - 1];
      if (e.shiftKey && (document.activeElement === primeiro || !el.contains(document.activeElement))) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && (document.activeElement === ultimo || !el.contains(document.activeElement))) {
        e.preventDefault();
        primeiro.focus();
      }
    }
    document.addEventListener("keydown", teclas);
    return () => {
      document.removeEventListener("keydown", teclas);
      document.body.style.overflow = overflow;
      anterior?.focus?.();
    };
  }, [anterior]);

  const classes = `vidro-forte max-h-[90dvh] w-full overflow-y-auto rounded-t-[22px] border-x-0 border-b-0 px-5 pt-2.5 pb-[max(22px,env(safe-area-inset-bottom))] outline-none ${largura} md:rounded-[22px] md:border md:px-6 md:pb-6 md:pt-6`;
  const conteudo = (
    <>
      <div aria-hidden="true" className="mx-auto mb-3.5 h-[5px] w-9 rounded-full bg-seta md:hidden" />
      <h2 id={idTitulo} className="m-0 text-[20px] font-bold tracking-[-0.01em] text-texto">
        {titulo}
      </h2>
      {subtitulo ? <p className="m-0 mt-1 text-[14px] text-sec">{subtitulo}</p> : null}
      <div className="mt-3.5">{children}</div>
    </>
  );

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 md:items-center md:p-4">
      {onSubmit ? (
        <form
          ref={(n) => {
            painel.current = n;
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby={idTitulo}
          tabIndex={-1}
          onSubmit={onSubmit}
          className={classes}
        >
          {conteudo}
        </form>
      ) : (
        <div
          ref={(n) => {
            painel.current = n;
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby={idTitulo}
          tabIndex={-1}
          className={classes}
        >
          {conteudo}
        </div>
      )}
    </div>
  );
}

/** Rodapé de botões da folha: Cancelar e a ação principal, lado a lado. */
export function RodapeFolha({ children }: { children: ReactNode }) {
  return <div className="mt-4 flex gap-2.5 [&>*]:flex-1">{children}</div>;
}
