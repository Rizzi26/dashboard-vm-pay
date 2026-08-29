const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const inteiro = new Intl.NumberFormat("pt-BR");

/** Eixo de gráfico: "R$ 1,2 mil" cabe onde "R$ 1.202,40" não cabe. */
const brlCompacto = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});

const dataCurta = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
});

export const formatMoney = (v: number) => brl.format(v);
export const formatMoneyCompact = (v: number) => brlCompacto.format(v);
export const formatInt = (v: number) => inteiro.format(Math.round(v));

/** Datas vêm como YYYY-MM-DD; `new Date` sobre isso vira UTC e pode voltar um dia. */
export const formatDay = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return dataCurta.format(new Date(y, m - 1, d));
};

// Fuso fixo: o servidor da Vercel renderiza em UTC — sem ele, todo horário
// apareceria 3h adiantado para quem opera em Brasília.
const dataHora = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

export const formatDayTime = (iso: string) => dataHora.format(new Date(iso));

export function formatAtraso(segundos: number | null): string {
  if (segundos === null) return "nunca sincronizou";
  if (segundos < 60) return "agora há pouco";
  const min = Math.floor(segundos / 60);
  if (min < 60) return `há ${min} min`;
  const horas = Math.floor(min / 60);
  if (horas < 24) return `há ${horas} h`;
  return `há ${Math.floor(horas / 24)} d`;
}
