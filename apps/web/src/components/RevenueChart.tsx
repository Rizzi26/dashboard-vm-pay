"use client";

import { useMemo, useRef, useState } from "react";
import type { DailyPoint } from "@/lib/api";
import { formatDay, formatInt, formatMoney, formatMoneyCompact } from "@/lib/format";

const W = 800;
const H = 260;
// right acomoda o rótulo do eixo: em BRL "R$ 1,2 mil" é mais largo do que
// parece, e cortar número num painel de faturamento é pior que apertar o plot.
const PAD = { top: 16, right: 78, bottom: 28, left: 16 };

/**
 * Faturamento diário — uma série só, então sem legenda: o título nomeia a série.
 *
 * Faturamento e transações não dividem o mesmo gráfico. São escalas diferentes,
 * e dois eixos y no mesmo plot fazem o leitor comparar formas que não são
 * comparáveis; transações ficam no tooltip e nos tiles.
 */
export function RevenueChart({ points }: { points: DailyPoint[] }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  const geo = useMemo(() => {
    if (points.length === 0) return null;
    const max = Math.max(...points.map((p) => p.faturamento), 1);
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const x = (i: number) =>
      PAD.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
    const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
    return {
      max,
      x,
      y,
      path: points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.faturamento)}`).join(" "),
      ticks: [0, 0.5, 1].map((f) => ({ v: max * f, y: y(max * f) })),
    };
  }, [points]);

  if (!geo) {
    return (
      <p className="py-12 text-center text-sm text-[var(--text-secondary)]">
        Sem vendas no período.
      </p>
    );
  }

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const rel = ((e.clientX - rect.left) / rect.width) * W;
    const innerW = W - PAD.left - PAD.right;
    const frac = (rel - PAD.left) / innerW;
    const i = Math.round(frac * (points.length - 1));
    setHover(Math.min(points.length - 1, Math.max(0, i)));
  };

  const ativo = hover === null ? null : points[hover];
  const ultimo = points[points.length - 1];

  return (
    <div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`Faturamento diário, ${points.length} dias, máximo ${formatMoney(geo.max)}`}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {/* Grade recessiva: orienta a leitura sem competir com a linha. */}
        {geo.ticks.map((t) => (
          <g key={t.v}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={t.y}
              y2={t.y}
              stroke="var(--grid)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={W - PAD.right + 8}
              y={t.y + 4}
              fill="var(--text-secondary)"
              fontSize="11"
              className="tabular-nums"
            >
              {formatMoneyCompact(t.v)}
            </text>
          </g>
        ))}

        <path
          d={geo.path}
          fill="none"
          stroke="var(--series-1)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />

        {/* Rótulo direto só no último ponto — número em todo ponto vira ruído. */}
        <circle
          cx={geo.x(points.length - 1)}
          cy={geo.y(ultimo.faturamento)}
          r="4"
          fill="var(--series-1)"
          stroke="var(--surface-1)"
          strokeWidth="2"
        />

        {ativo && hover !== null ? (
          <g>
            <line
              x1={geo.x(hover)}
              x2={geo.x(hover)}
              y1={PAD.top}
              y2={H - PAD.bottom}
              stroke="var(--grid)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
            {/* Anel na cor da superfície separa a marca da linha por baixo. */}
            <circle
              cx={geo.x(hover)}
              cy={geo.y(ativo.faturamento)}
              r="5"
              fill="var(--series-1)"
              stroke="var(--surface-1)"
              strokeWidth="2"
            />
          </g>
        ) : null}

        <text x={PAD.left} y={H - 8} fill="var(--text-secondary)" fontSize="11">
          {formatDay(points[0].dia)}
        </text>
        <text
          x={W - PAD.right}
          y={H - 8}
          fill="var(--text-secondary)"
          fontSize="11"
          textAnchor="end"
        >
          {formatDay(ultimo.dia)}
        </text>
      </svg>

      <div className="mt-2 flex min-h-[2.5rem] items-start justify-between gap-4">
        <div className="text-sm">
          {ativo ? (
            <span className="text-[var(--text-primary)]">
              <span className="font-medium">{formatDay(ativo.dia)}</span>
              {" · "}
              <span className="tabular-nums">{formatMoney(ativo.faturamento)}</span>
              {" · "}
              <span className="tabular-nums text-[var(--text-secondary)]">
                {formatInt(ativo.transacoes)} transações
              </span>
            </span>
          ) : (
            <span className="text-[var(--text-secondary)]">
              Passe o cursor sobre o gráfico para ver o dia.
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowTable((v) => !v)}
          className="shrink-0 text-xs text-[var(--text-secondary)] underline underline-offset-2"
        >
          {showTable ? "ocultar tabela" : "ver como tabela"}
        </button>
      </div>

      {showTable ? (
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-[var(--text-secondary)]">
              <th className="py-1 font-medium">Dia</th>
              <th className="py-1 text-right font-medium">Faturamento</th>
              <th className="py-1 text-right font-medium">Transações</th>
            </tr>
          </thead>
          <tbody className="text-[var(--text-primary)]">
            {points.map((p) => (
              <tr key={p.dia} className="border-t border-[var(--grid)]">
                <td className="py-1">{formatDay(p.dia)}</td>
                <td className="py-1 text-right tabular-nums">{formatMoney(p.faturamento)}</td>
                <td className="py-1 text-right tabular-nums">{formatInt(p.transacoes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
