// Visual da proposta (paginacao() do tema): setas redondas, a ativa tingida
// de azul e a do fim em cinza. 44px no celular (alvo de toque), 36px no
// computador. Arquivo próprio (sem "use client") porque Paginacao é de
// cliente e PaginacaoLinks de servidor: constante exportada de módulo de
// cliente chega ao servidor como referência, não como string.
export const PAGINACAO_NAV =
  "mt-3.5 flex items-center justify-between gap-3 text-[14px] text-sec";
const SETA_BASE =
  "inline-flex h-11 w-11 items-center justify-center rounded-full border-0 text-[20px] leading-none no-underline md:h-9 md:w-9 md:text-[18px]";
export const PAGINACAO_SETA = `${SETA_BASE} bg-azul-tinta text-azul-texto`;
export const PAGINACAO_SETA_OFF = `${SETA_BASE} bg-trilho text-seta cursor-default`;
