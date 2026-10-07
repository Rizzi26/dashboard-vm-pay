"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { TopProdutos } from "@/lib/api";
import { formatDay, formatInt, formatMoney, formatMoneyCompact } from "@/lib/format";
import { Paginacao, usePaginacao } from "@/components/Paginacao";
import { Segmentado } from "@/components/ui/Segmentado";

type Metrica = "faturamento" | "unidades";
type Produto = TopProdutos["produtos"][number];

const METRICAS = [
  { valor: "faturamento", rotulo: "Faturamento" },
  { valor: "unidades", rotulo: "Unidades" },
];

const mesCurto = new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit" });
const mesLongo = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" });

function data(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Rótulo curto do balde (eixo e tabela). */
function rotuloBalde(iso: string, g: TopProdutos["granularidade"]) {
  if (g === "mes") return mesCurto.format(data(iso)).replace(". de ", "/").replace(".", "");
  return formatDay(iso);
}

/** Título do tooltip: diz o que o ponto cobre, não só onde começa. */
function tituloBalde(iso: string, g: TopProdutos["granularidade"]) {
  if (g === "mes") return mesLongo.format(data(iso));
  if (g === "semana") return `Semana de ${formatDay(iso)}`;
  return formatDay(iso);
}

/** Fim (exclusivo) do balde, para saber se ele cobre só parte da janela. */
function fimBalde(iso: string, g: TopProdutos["granularidade"]) {
  const d = data(iso);
  if (g === "mes") return new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + (g === "semana" ? 7 : 1));
}

function cortar(texto: string, max: number) {
  return texto.length > max ? `${texto.slice(0, max - 1).trimEnd()}…` : texto;
}

/** Teto "redondo" do eixo: 0 / 250 / 500 em vez de 0 / 237 / 474. */
function escala(max: number) {
  if (max <= 0) return { teto: 1, passo: 1 };
  const bruto = max / 4;
  const mag = 10 ** Math.floor(Math.log10(bruto));
  const passo = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((p) => p >= bruto) ?? 10 * mag;
  return { teto: Math.ceil(max / passo) * passo, passo };
}

const cor = (p: Produto) => `var(--cat-${p.posicao})`;

/**
 * Os N mais vendidos ao longo do período — uma linha por produto, um eixo só.
 *
 * Cor por POSIÇÃO (--cat-1..5, ordem fixa validada): o 1º é sempre azul. Como
 * o ranking não muda ao trocar a métrica, a cor também não muda — o leitor
 * que aprendeu "a Coca é azul" continua certo em Unidades.
 *
 * Faturamento e unidades nunca dividem o plot (seriam dois eixos y): o
 * Segmentado troca a métrica do eixo inteiro.
 *
 * Rótulo direto no fim de cada linha só no computador; com rótulos
 * empurrados para não colidir, uma linha-guia liga o rótulo ao ponto. No
 * celular não há margem para isso, e a legenda + tooltip fazem o trabalho.
 *
 * Vai dentro de SuperficieGrafico: as cores e o anel dos pontos contam com o
 * fundo sólido (--surface-1).
 */
export function TopProdutosChart({ dados }: { dados: TopProdutos }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [metrica, setMetrica] = useState<Metrica>("faturamento");
  const [hover, setHover] = useState<number | null>(null);
  const [tabela, setTabela] = useState(false);
  const { produtos, pontos, granularidade: g } = dados;
  const pag = usePaginacao([...pontos].reverse(), 20);

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

  const estreito = width < 640;
  const W = width;
  const H = width < 480 ? 220 : 300;
  const PAD = useMemo(
    () => ({ top: 14, right: estreito ? 12 : 172, bottom: 28, left: width < 480 ? 50 : 64 }),
    [estreito, width],
  );
  const fmt = metrica === "faturamento" ? formatMoney : formatInt;
  const fmtEixo = metrica === "faturamento" ? formatMoneyCompact : formatInt;

  const geo = useMemo(() => {
    if (produtos.length === 0 || pontos.length === 0) return null;
    const valor = (i: number, p: Produto) => pontos[i].valores[p.chave]?.[metrica] ?? 0;
    const max = Math.max(0, ...pontos.flatMap((_, i) => produtos.map((p) => valor(i, p))));
    const { teto, passo } = escala(max);
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const x = (i: number) =>
      PAD.left + (pontos.length === 1 ? innerW / 2 : (i / (pontos.length - 1)) * innerW);
    const y = (v: number) => PAD.top + innerH - (v / teto) * innerH;
    const ticks: number[] = [];
    for (let v = 0; v <= teto + passo / 2; v += passo) ticks.push(v);

    const linhas = produtos.map((p) => ({
      p,
      d: pontos.map((_, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(valor(i, p))}`).join(" "),
      fimY: y(valor(pontos.length - 1, p)),
    }));

    // Rótulos do fim: ordena pela altura e empurra para baixo até não
    // encostarem (13px); se estourar o plot, sobe o bloco todo.
    const ALTURA = 14;
    const rotulos = [...linhas].sort((a, b) => a.fimY - b.fimY).map((l) => ({ ...l, ly: l.fimY }));
    for (let k = 1; k < rotulos.length; k++) {
      rotulos[k].ly = Math.max(rotulos[k].ly, rotulos[k - 1].ly + ALTURA);
    }
    const base = H - PAD.bottom;
    const excesso = (rotulos.at(-1)?.ly ?? 0) - base;
    if (excesso > 0) {
      for (const r of rotulos) r.ly -= excesso;
      for (let k = rotulos.length - 2; k >= 0; k--) {
        rotulos[k].ly = Math.min(rotulos[k].ly, rotulos[k + 1].ly - ALTURA);
      }
    }

    // Eixo x: o primeiro, o último e alguns no meio, sem amontoar.
    const n = pontos.length;
    const qtd = Math.min(n, width < 480 ? 3 : 6);
    const xTicks =
      qtd <= 1 ? [0] : Array.from(new Set(Array.from({ length: qtd }, (_, k) => Math.round((k * (n - 1)) / (qtd - 1)))));

    return { valor, x, y, ticks, linhas, rotulos, xTicks };
  }, [produtos, pontos, metrica, W, H, PAD, width]);

  if (!geo) {
    return <p className="py-12 text-center text-sm text-sec">Sem vendas no período.</p>;
  }

  const ultimo = pontos.length - 1;
  const fimPeriodo = data(dados.periodo.fim);
  fimPeriodo.setDate(fimPeriodo.getDate() + 1);
  const inicioPeriodo = data(dados.periodo.inicio);
  const parcial = (iso: string) =>
    g !== "dia" && (data(iso) < inicioPeriodo || fimBalde(iso, g) > fimPeriodo);

  const indicePelo = (clientX: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const rel = ((clientX - rect.left) / rect.width) * W;
    const frac = (rel - PAD.left) / (W - PAD.left - PAD.right);
    return Math.min(ultimo, Math.max(0, Math.round(frac * ultimo)));
  };
  const onMove = (e: PointerEvent<SVGSVGElement>) => setHover(indicePelo(e.clientX));
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const passo = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setHover(e.key === "Home" ? 0 : ultimo);
    } else if (passo) {
      e.preventDefault();
      setHover((h) => Math.min(ultimo, Math.max(0, (h ?? ultimo) + passo)));
    } else if (e.key === "Escape") {
      setHover(null);
    }
  };

  const ativo = hover === null ? null : pontos[hover];
  // Tooltip do lado oposto ao cursor (não cobre o ponto lido), preso dentro
  // do gráfico.
  const tipW = Math.min(290, Math.round(W * 0.4));
  const tipLeft =
    hover === null
      ? 0
      : geo.x(hover) > W / 2
        ? Math.max(0, geo.x(hover) - 12 - tipW)
        : Math.min(W - tipW, geo.x(hover) + 12);
  // Valor na frente, nome depois: aqui o leitor já sabe a série e quer o número.
  const leitura =
    ativo && hover !== null ? (
      <>
        <p className="m-0 mb-1 font-medium text-texto">
          {tituloBalde(ativo.inicio, g)}
          {parcial(ativo.inicio) ? <span className="font-normal text-sec"> · parcial</span> : null}
        </p>
        <ul className="m-0 list-none space-y-0.5 p-0">
          {[...produtos]
            .sort((a, b) => geo.valor(hover, b) - geo.valor(hover, a) || a.posicao - b.posicao)
            .map((p) => (
              <li key={p.chave} className="flex items-center gap-2">
                <span aria-hidden className="inline-block h-[2px] w-3 shrink-0 rounded-full" style={{ background: cor(p) }} />
                <span className="shrink-0 font-semibold tabular-nums text-texto">{fmt(geo.valor(hover, p))}</span>
                <span className="min-w-0 truncate text-sec">{p.produto}</span>
              </li>
            ))}
        </ul>
      </>
    ) : null;
  const descricao = `${produtos.length} produtos mais vendidos, ${metrica}, ${pontos.length} pontos por ${
    g === "mes" ? "mês" : g
  }. Use as setas para percorrer.`;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        {/* Legenda: sempre presente; o traço na cor da série carrega a
            identidade, o texto fica na cor de texto. */}
        <ol className="m-0 flex min-w-0 flex-1 list-none flex-wrap gap-x-4 gap-y-1.5 p-0 text-[13px]" aria-label="Legenda">
          {produtos.map((p) => (
            <li key={p.chave} className="flex min-w-0 max-w-full items-center gap-1.5">
              <span aria-hidden className="inline-block h-[3px] w-3.5 shrink-0 rounded-full" style={{ background: cor(p) }} />
              <span className="shrink-0 tabular-nums text-sec">{p.posicao}º</span>
              <span className="min-w-0 max-w-[16rem] truncate text-texto" title={p.produto}>
                {p.produto}
              </span>
            </li>
          ))}
        </ol>
        <Segmentado
          rotulo="Métrica do gráfico"
          opcoes={METRICAS}
          valor={metrica}
          onMudar={(v) => setMetrica(v as Metrica)}
          largo={estreito}
          className={estreito ? "" : "shrink-0"}
        />
      </div>

      <div ref={wrapRef} className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full rounded-[10px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          role="img"
          aria-label={descricao}
          tabIndex={0}
          style={{ touchAction: "pan-y" }}
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={(e) => {
            // No toque, o balde tocado continua selecionado.
            if (e.pointerType === "mouse") setHover(null);
          }}
          onFocus={() => setHover((h) => h ?? ultimo)}
          onBlur={() => setHover(null)}
          onKeyDown={onKey}
        >
          {geo.ticks.map((v) => (
            <g key={v}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={geo.y(v)}
                y2={geo.y(v)}
                stroke="var(--grid)"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={PAD.left - 8}
                y={geo.y(v) + 4}
                fill="var(--text-secondary)"
                fontSize="11"
                textAnchor="end"
                className="tabular-nums"
              >
                {fmtEixo(v)}
              </text>
            </g>
          ))}

          {geo.xTicks.map((i) => (
            <text
              key={i}
              x={geo.x(i)}
              y={H - 8}
              fill="var(--text-secondary)"
              fontSize="11"
              textAnchor={pontos.length === 1 ? "middle" : i === 0 ? "start" : i === ultimo ? "end" : "middle"}
              className="tabular-nums"
            >
              {rotuloBalde(pontos[i].inicio, g)}
            </text>
          ))}

          {/* Do 5º para o 1º: o mais vendido fica por cima quando se cruzam. */}
          {[...geo.linhas].reverse().map(({ p, d }) => (
            <path
              key={p.chave}
              d={d}
              fill="none"
              stroke={cor(p)}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {[...geo.linhas].reverse().map(({ p, fimY }) => (
            <circle key={p.chave} cx={geo.x(ultimo)} cy={fimY} r="4" fill={cor(p)} stroke="var(--surface-1)" strokeWidth="2" />
          ))}

          {!estreito
            ? geo.rotulos.map(({ p, fimY, ly }) => {
                const x0 = geo.x(ultimo) + 7;
                const xr = W - PAD.right + 18;
                return (
                  <g key={p.chave}>
                    {/* Linha-guia: o rótulo empurrado continua preso ao ponto. */}
                    <path
                      d={`M${x0},${fimY} L${xr - 10},${fimY} L${xr - 4},${ly}`}
                      fill="none"
                      stroke="var(--grid)"
                      strokeWidth="1"
                      vectorEffect="non-scaling-stroke"
                    />
                    <text x={xr} y={ly + 4} fontSize="11" fill="var(--text-primary)">
                      <title>{p.produto}</title>
                      <tspan fill="var(--text-secondary)" className="tabular-nums">
                        {p.posicao}º{" "}
                      </tspan>
                      {cortar(p.produto, 21)}
                    </text>
                  </g>
                );
              })
            : null}

          {ativo && hover !== null ? (
            <g>
              <line
                x1={geo.x(hover)}
                x2={geo.x(hover)}
                y1={PAD.top}
                y2={H - PAD.bottom}
                stroke="var(--text-secondary)"
                strokeOpacity="0.5"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
              {[...produtos].reverse().map((p) => (
                <circle
                  key={p.chave}
                  cx={geo.x(hover)}
                  cy={geo.y(geo.valor(hover, p))}
                  r="4.5"
                  fill={cor(p)}
                  stroke="var(--surface-1)"
                  strokeWidth="2"
                />
              ))}
            </g>
          ) : null}
        </svg>

        {leitura && !estreito ? (
          <div
            className="pointer-events-none absolute top-2 z-10 rounded-xl border border-solido-borda bg-solido px-3 py-2 text-[13px] shadow-vidro"
            style={{ left: tipLeft, width: tipW }}
          >
            {leitura}
          </div>
        ) : null}
      </div>

      {/* No celular a leitura desce para baixo do gráfico: flutuando, ela
          cobriria metade das linhas. */}
      <div aria-live="polite" className={leitura && estreito ? "mt-2 text-[13px]" : "sr-only"}>
        {leitura}
      </div>

      <div className="mt-2 flex min-h-[2.5rem] items-start justify-between gap-4">
        <p className="m-0 text-sm text-sec">
          {leitura && estreito
            ? null
            : `Toque ou passe o cursor sobre o gráfico para ver ${g === "mes" ? "o mês" : g === "semana" ? "a semana" : "o dia"}.`}
        </p>
        <button
          type="button"
          onClick={() => setTabela((v) => !v)}
          className="min-h-11 shrink-0 text-[13px] text-azul-texto md:min-h-0"
        >
          {tabela ? "ocultar tabela" : "ver como tabela"}
        </button>
      </div>

      {tabela ? (
        <div className="overflow-x-auto">
          <table className="mt-3 w-full text-sm">
            <caption className="mb-1 text-left text-xs text-sec">
              {metrica === "faturamento" ? "Faturamento" : "Unidades"} por {g === "mes" ? "mês" : g}, do mais recente
            </caption>
            <thead>
              <tr className="border-b border-sep text-left text-[12px] font-semibold text-sec">
                <th className="py-2 pr-3 font-medium">{g === "mes" ? "Mês" : g === "semana" ? "Semana" : "Dia"}</th>
                {produtos.map((p) => (
                  <th key={p.chave} className="max-w-[9rem] py-2 pl-3 text-right font-medium">
                    <span className="block truncate" title={p.produto}>
                      {p.posicao}º {p.produto}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="text-texto">
              {pag.visiveis.map((pt) => (
                <tr key={pt.inicio} className="border-t border-sep hover:bg-[var(--row-hover)]">
                  <td className="whitespace-nowrap py-2 pr-3">
                    {rotuloBalde(pt.inicio, g)}
                    {parcial(pt.inicio) ? <span className="text-sec"> (parcial)</span> : null}
                  </td>
                  {produtos.map((p) => (
                    <td key={p.chave} className="whitespace-nowrap py-2 pl-3 text-right tabular-nums">
                      {fmt(pt.valores[p.chave]?.[metrica] ?? 0)}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="border-t border-sep font-semibold">
                <td className="py-2 pr-3">Período</td>
                {produtos.map((p) => (
                  <td key={p.chave} className="whitespace-nowrap py-2 pl-3 text-right tabular-nums">
                    {fmt(p[metrica])}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
          <Paginacao {...pag.rodape} rotulo={g === "mes" ? "meses" : g === "semana" ? "semanas" : "dias"} />
        </div>
      ) : null}
    </div>
  );
}
