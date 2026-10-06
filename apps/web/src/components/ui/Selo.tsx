import type { ReactNode } from "react";

export type TomSelo = "azul" | "verde" | "laranja" | "vermelho" | "cinza";

const TONS: Record<TomSelo, string> = {
  azul: "text-azul-texto bg-azul-tinta",
  verde: "text-verde-texto bg-verde-fundo",
  laranja: "text-laranja-texto bg-laranja-fundo",
  vermelho: "text-vermelho-texto bg-vermelho-fundo",
  cinza: "text-sec bg-trilho",
};

/** Símbolo padrão de cada tom de status: forma diferente, não só cor. */
const SIMBOLO_PADRAO: Partial<Record<TomSelo, string>> = {
  verde: "●",
  laranja: "▲",
  vermelho: "■",
};

/**
 * Pílula de status. Status nunca vai só por cor: em verde/laranja/vermelho o
 * símbolo (● ▲ ■) entra sozinho; `simbolo={null}` tira quando o selo não é
 * status (ex.: classe "A" da curva ABC), `simbolo="…"` troca.
 */
export function Selo({
  tom = "cinza",
  simbolo,
  className = "",
  children,
}: {
  tom?: TomSelo;
  simbolo?: string | null;
  className?: string;
  children: ReactNode;
}) {
  const s = simbolo === undefined ? SIMBOLO_PADRAO[tom] : simbolo;
  return (
    <span
      className={`inline-flex items-center gap-[5px] whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${TONS[tom]} ${className}`}
    >
      {s ? <span aria-hidden="true">{s}</span> : null}
      {children}
    </span>
  );
}
