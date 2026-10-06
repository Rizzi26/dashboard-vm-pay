import type { ReactNode } from "react";

export type TomTile = "critico" | "alerta" | "positivo";
export type CorIcone = "azul" | "roxo" | "laranja" | "verde" | "vermelho";

const COR_VALOR: Record<TomTile, string> = {
  critico: "text-vermelho-texto",
  alerta: "text-laranja-texto",
  positivo: "text-verde-texto",
};

const COR_ICONE: Record<CorIcone, string> = {
  azul: "text-azul bg-azul-tinta",
  roxo: "text-roxo bg-roxo-fundo",
  laranja: "text-laranja-texto bg-laranja-fundo",
  verde: "text-verde-texto bg-verde-fundo",
  vermelho: "text-vermelho-texto bg-vermelho-fundo",
};

/**
 * Número em destaque (tile() da proposta). Sem gráfico e sem hover — quando o
 * dado é um valor só, o gráfico é ruído. Com onClick vira botão de filtro
 * (aria-pressed). `destaque` pinta o tile inteiro de vermelho, como o
 * "Zerados" da Prateleira — use com símbolo no rótulo ("■ Zerados").
 */
export function Tile({
  rotulo,
  valor,
  dica,
  icone,
  corIcone = "azul",
  tom,
  destaque = false,
  onClick,
  ativo,
  className = "",
}: {
  rotulo: ReactNode;
  valor: ReactNode;
  dica?: ReactNode;
  /** Um dos ícones de ui/icones (tamanho 14). */
  icone?: ReactNode;
  corIcone?: CorIcone;
  tom?: TomTile;
  destaque?: boolean;
  onClick?: () => void;
  ativo?: boolean;
  className?: string;
}) {
  const caixa = destaque
    ? "border-[1.5px] border-vermelho-borda bg-vermelho-fundo"
    : `vidro ${ativo ? "outline-2 outline-azul" : ""}`;
  const corValor = destaque ? COR_VALOR.critico : tom ? COR_VALOR[tom] : "text-texto";

  const dentro = (
    <>
      <div
        className={`flex items-center gap-2 text-[12px] font-medium md:text-[13px] ${destaque ? "text-vermelho-texto" : "text-sec"}`}
      >
        {icone ? (
          <span
            className={`inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg ${COR_ICONE[corIcone]}`}
          >
            {icone}
          </span>
        ) : null}
        <span className="min-w-0">{rotulo}</span>
      </div>
      {/* 22px no celular (mini() da proposta): o tile de grid-cols-2 tem
          ~170px e "R$ 12.280,84" estoura em 30px; break-words segura o pior
          caso em vez de vazar. */}
      <div
        className={`mt-1 break-words text-[22px] font-bold leading-tight tracking-[-0.02em] tabular-nums md:mt-2 md:text-[30px] ${corValor}`}
      >
        {valor}
      </div>
      {dica ? <div className="mt-1 text-[12px] text-sec md:text-[13px]">{dica}</div> : null}
    </>
  );

  const base = `min-w-0 rounded-[18px] p-3.5 md:rounded-[20px] md:px-5 md:py-[18px] ${caixa} ${className}`;
  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-pressed={ativo} className={`w-full text-left ${base}`}>
        {dentro}
      </button>
    );
  }
  return <div className={base}>{dentro}</div>;
}
