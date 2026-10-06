"use client";

import { useSair } from "./useSair";

/** "Sair" da tela Mais: largo, texto vermelho sobre fundo de lista (CelMais). */
export function BotaoSair({ org }: { org: string }) {
  const sair = useSair(org);
  return (
    <button
      type="button"
      onClick={sair}
      className="vidro-lista h-12 w-full rounded-[14px] text-[17px] text-vermelho-texto"
    >
      Sair
    </button>
  );
}
