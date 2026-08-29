"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { StockHistoryPoint } from "@/lib/api";
import { formatDayTime, formatInt } from "@/lib/format";

/**
 * Saldo ao longo do tempo, uma amostra por sincronização.
 *
 * A linha é em DEGRAUS, não interpolada: o saldo é discreto e só muda quando
 * uma foto o registra — ligar dois pontos com reta inclinada sugeriria um
 * escoamento contínuo que não aconteceu. Degrau para baixo = saiu produto;
 * degrau para cima = reposição.
 */
export function StockHistoryChart({ points }: { points: StockHistoryPoint[] }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(Math.round(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Mais de um local com o mesmo produto: o gráfico mostra o total por foto.
  const serie = useMemo(() => {
    const porFoto = new Map<string, number>();
    for (const p of points) {
      porFoto.set(p.em, (porFoto.get(p.em) ?? 0) + p.quantidade);
    }
    return [...porFoto.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([em, quantidade]) => ({ em, quantidade }));
  }, [points]);

  const W = width;
  const H = width < 480 ? 160 : 200;
  const PAD = useMemo(
    () => ({ top: 16, right: width < 480 ? 40 : 56, bottom: 28, left: 16 }),
    [width],
  );

  const geo = useMemo(() => {
    if (serie.length === 0) return null;
    const max = Math.max(...serie.map((p) => p.quantidade), 1);
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const x = (i: number) =>
      PAD.left + (serie.length === 1 ? innerW / 2 : (i / (serie.length - 1)) * innerW);
    const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
    // Degrau: mantém o valor anterior até a foto seguinte (H antes de V).
    const path = serie
      .map((p, i) =>
        i === 0
          ? `M${x(0)},${y(p.quantidade)}`
          : `H${x(i)} V${y(p.quantidade)}`,
      )
      .join(" ");
    return { max, x, y, path, ticks: [0, 0.5, 1].map((f) => ({ f, v: max * f, y: y(max * f) })) };
  }, [serie, W, H, PAD]);

  if (!geo || serie.length < 2) {
    return (
      <p className="py-10 text-center text-sm text-[var(--text-secondary)]">
        O histórico acumula a cada sincronização — volte após algumas rodadas
        para ver a curva.
      </p>
    );
  }

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const rel = ((e.clientX - rect.left) / rect.width) * W;
    const innerW = W - PAD.left - PAD.right;
    const i = Math.round(((rel - PAD.left) / innerW) * (serie.length - 1));
    setHover(Math.min(serie.length - 1, Math.max(0, i)));
  };

  const ativo = hover === null ? null : serie[hover];
  const ultimo = serie[serie.length - 1];

  return (
    <div ref={wrapRef}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`Saldo em prateleira, ${serie.length} sincronizações, máximo ${formatInt(geo.max)}`}
        style={{ touchAction: "pan-y" }}
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") setHover(null);
        }}
      >
        {geo.ticks.map((t) => (
          <g key={t.f}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={t.y}
              y2={t.y}
              stroke="var(--grid)"
              strokeWidth="1"
              strokeDasharray={t.f === 0 ? undefined : "2 4"}
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={W - PAD.right + 8}
              y={t.y + 4}
              fill="var(--text-secondary)"
              fontSize="11"
              className="tabular-nums"
            >
              {formatInt(t.v)}
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

        <circle
          cx={geo.x(serie.length - 1)}
          cy={geo.y(ultimo.quantidade)}
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
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={geo.x(hover)}
              cy={geo.y(ativo.quantidade)}
              r="5"
              fill="var(--series-1)"
              stroke="var(--surface-1)"
              strokeWidth="2"
            />
          </g>
        ) : null}

        <text
          x={PAD.left}
          y={H - 8}
          fill="var(--text-secondary)"
          fontSize="11"
          className="tabular-nums"
        >
          {formatDayTime(serie[0].em)}
        </text>
        <text
          x={W - PAD.right}
          y={H - 8}
          fill="var(--text-secondary)"
          fontSize="11"
          textAnchor="end"
          className="tabular-nums"
        >
          {formatDayTime(ultimo.em)}
        </text>
      </svg>

      <div className="mt-2 min-h-[1.5rem] text-sm">
        {ativo ? (
          <span className="text-[var(--text-primary)]">
            <span className="font-medium">{formatDayTime(ativo.em)}</span>
            {" · "}
            <span className="tabular-nums">{formatInt(ativo.quantidade)} un.</span>
          </span>
        ) : (
          <span className="text-[var(--text-secondary)]">
            Toque ou passe o cursor para ver cada sincronização.
          </span>
        )}
      </div>
    </div>
  );
}
