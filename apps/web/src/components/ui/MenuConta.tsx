"use client";

import { useEffect, useId, useRef, useState } from "react";
import { inicialDe, ROLE_LABEL } from "./navegacao";
import { useSair } from "./useSair";

/**
 * Avatar da barra com o menu da conta (email, papel, Sair). Disclosure
 * simples — botão + painel — e não role="menu": são só um texto e um botão,
 * e o padrão de menu exigiria navegação por setas sem ganho nenhum.
 */
export function MenuConta({
  org,
  orgName,
  role,
  email,
}: {
  org: string;
  orgName: string;
  role: string;
  email: string | null;
}) {
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const painelId = useId();
  const sair = useSair(org);

  useEffect(() => {
    if (!aberto) return;
    function fora(e: MouseEvent) {
      if (!caixa.current?.contains(e.target as Node)) setAberto(false);
    }
    function esc(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setAberto(false);
        botao.current?.focus();
      }
    }
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aberto]);

  return (
    <div ref={caixa} className="relative">
      <button
        ref={botao}
        type="button"
        aria-label={`Conta de ${email ?? "usuário"}`}
        aria-expanded={aberto}
        aria-controls={painelId}
        onClick={() => setAberto((v) => !v)}
        className="flex h-9 w-9 items-center justify-center rounded-full border-0 text-[13px] font-semibold text-white"
        style={{ background: "var(--avatar)" }}
      >
        {inicialDe(email)}
      </button>
      <div
        id={painelId}
        hidden={!aberto}
        className="vidro-forte absolute right-0 top-full z-40 mt-2 w-72 rounded-2xl p-1.5"
      >
        <div className="px-3 py-2.5">
          <div className="truncate text-[15px] font-semibold text-texto">{email ?? "—"}</div>
          <div className="mt-0.5 text-[13px] text-sec">
            {ROLE_LABEL[role] ?? role} · {orgName}
          </div>
        </div>
        <div className="mx-3 h-px bg-sep" />
        <button
          type="button"
          onClick={sair}
          className="mt-1 flex h-10 w-full items-center rounded-xl border-0 bg-transparent px-3 text-left text-[15px] text-vermelho-texto hover:bg-vermelho-fundo"
        >
          Sair
        </button>
      </div>
    </div>
  );
}
