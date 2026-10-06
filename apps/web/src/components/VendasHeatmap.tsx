"use client";

import { useMemo, useState } from "react";
import { formatInt, formatMoney } from "@/lib/format";

export type Celula = { dia: number; hora: number; faturamento: number; transacoes: number };

/** isodow da API: 1 = segunda … 7 = domingo. */
const DIAS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const FAIXAS = 5;

function faixa(valor: number, maximo: number): number {
  if (valor <= 0 || maximo <= 0) return 0;
  return Math.min(FAIXAS, Math.max(1, Math.ceil((valor / maximo) * FAIXAS)));
}

/**
 * Quando a loja vende: faturamento por dia da semana × hora (Brasília).
 * Magnitude → uma cor só, claro → escuro (tokens --seq-*). Célula vazia =
 * sem venda. Cada célula tem tooltip no hover e no foco; a tabela dos
 * melhores horários é a alternativa sem cor.
 */
export function VendasHeatmap({ celulas }: { celulas: Celula[] }) {
  const [ativa, setAtiva] = useState<Celula | null>(null);
  const [tabela, setTabela] = useState(false);

  const { grade, maximo, melhores } = useMemo(() => {
    const grade = new Map(celulas.map((c) => [`${c.dia}-${c.hora}`, c]));
    const maximo = Math.max(0, ...celulas.map((c) => c.faturamento));
    const melhores = [...celulas].sort((a, b) => b.faturamento - a.faturamento).slice(0, 10);
    return { grade, maximo, melhores };
  }, [celulas]);

  if (celulas.length === 0) {
    return <p className="text-sm text-[var(--text-secondary)]">Sem vendas no período.</p>;
  }

  const rotulo = (c: Celula) =>
    `${DIAS[c.dia - 1]} ${String(c.hora).padStart(2, "0")}h · ${formatMoney(c.faturamento)} · ${formatInt(c.transacoes)} venda${c.transacoes === 1 ? "" : "s"}`;

  return (
    <div>
      {/* Linha do tooltip: fixa acima da grade, para não cobrir as células. */}
      <p aria-live="polite" className="mb-2 h-5 text-sm tabular-nums text-[var(--text-primary)]">
        {ativa ? rotulo(ativa) : <span className="text-[var(--text-secondary)]">Passe o cursor ou toque numa hora.</span>}
      </p>

      <div className="overflow-x-auto pb-1">
        <div className="grid min-w-[560px] gap-[2px]" style={{ gridTemplateColumns: "2.25rem repeat(24, minmax(0, 1fr))" }}>
          {/* Coluna dos dias fixa: no celular a grade rola de lado e o dia não some. */}
          <span className="sticky left-0 z-10 bg-[var(--surface-1)]" />
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} className="text-center text-[10px] tabular-nums text-[var(--text-secondary)]">
              {h % 3 === 0 ? `${h}h` : ""}
            </span>
          ))}
          {DIAS.map((nome, i) => (
            <div key={nome} className="contents">
              <span className="sticky left-0 z-10 bg-[var(--surface-1)] pr-1 text-right text-[11px] leading-[18px] text-[var(--text-secondary)]">
                {nome}
              </span>
              {Array.from({ length: 24 }, (_, h) => {
                const c = grade.get(`${i + 1}-${h}`) ?? { dia: i + 1, hora: h, faturamento: 0, transacoes: 0 };
                const f = faixa(c.faturamento, maximo);
                return (
                  <button
                    key={h}
                    type="button"
                    aria-label={rotulo(c)}
                    onPointerEnter={() => setAtiva(c)}
                    onFocus={() => setAtiva(c)}
                    onClick={() => setAtiva(c)}
                    className="h-[18px] rounded-[2px] border"
                    style={
                      f
                        ? { background: `var(--seq-${f})`, borderColor: "transparent" }
                        : { background: "transparent", borderColor: "var(--grid)" }
                    }
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--text-secondary)]">
        <span className="flex items-center gap-1.5" aria-hidden>
          menos
          {Array.from({ length: FAIXAS }, (_, k) => (
            <span key={k} className="inline-block h-3 w-4 rounded-[2px]" style={{ background: `var(--seq-${k + 1})` }} />
          ))}
          mais
          <span className="ml-2 inline-block h-3 w-4 rounded-[2px] border border-[var(--grid)]" /> sem venda
        </span>
        <button type="button" onClick={() => setTabela((t) => !t)} className="underline hover:text-[var(--text-primary)]">
          {tabela ? "ocultar tabela" : "ver como tabela"}
        </button>
      </div>

      {tabela ? (
        <table className="mt-3 w-full text-sm">
          <caption className="mb-1 text-left text-xs text-[var(--text-secondary)]">Os 10 horários que mais faturaram</caption>
          <thead>
            <tr className="text-left text-xs text-[var(--text-secondary)]">
              <th className="py-1 font-normal">Dia</th>
              <th className="py-1 font-normal">Hora</th>
              <th className="py-1 text-right font-normal">Faturamento</th>
              <th className="py-1 text-right font-normal">Vendas</th>
            </tr>
          </thead>
          <tbody>
            {melhores.map((c) => (
              <tr key={`${c.dia}-${c.hora}`} className="border-t border-[var(--grid)] tabular-nums text-[var(--text-primary)]">
                <td className="py-1">{DIAS[c.dia - 1]}</td>
                <td className="py-1">{String(c.hora).padStart(2, "0")}h</td>
                <td className="py-1 text-right">{formatMoney(c.faturamento)}</td>
                <td className="py-1 text-right">{formatInt(c.transacoes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
