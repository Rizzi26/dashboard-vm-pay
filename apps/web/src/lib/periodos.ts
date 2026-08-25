export const PERIODOS = [
  { key: "30", label: "30 dias", dias: 30 },
  { key: "90", label: "90 dias", dias: 90 },
  { key: "365", label: "12 meses", dias: 365 },
  { key: "tudo", label: "Tudo", dias: null },
] as const;

export function startFor(key: string): string {
  const periodo = PERIODOS.find((p) => p.key === key) ?? PERIODOS[0];
  if (periodo.dias === null) return "2000-01-01";
  const d = new Date();
  d.setDate(d.getDate() - periodo.dias);
  return d.toISOString().slice(0, 10);
}
