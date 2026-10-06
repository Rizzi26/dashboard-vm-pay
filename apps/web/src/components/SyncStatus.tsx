import type { SyncRow } from "@/lib/api";
import { formatAtraso, formatInt } from "@/lib/format";

/**
 * Frescor do dado.
 *
 * Sem isto, um worker parado passa por "dia fraco de vendas" — o gráfico
 * simplesmente para de subir e ninguém desconfia. A cor nunca carrega o estado
 * sozinha: vem sempre com ícone e texto.
 */
const ESTADOS = {
  ok: { cor: "var(--status-good)", icone: "●", texto: "em dia" },
  atrasado: { cor: "var(--status-warning)", icone: "▲", texto: "atrasado" },
  falha: { cor: "var(--status-critical)", icone: "■", texto: "com falha" },
} as const;

function estado(row: SyncRow): keyof typeof ESTADOS {
  if (row.ultimo_erro) return "falha";
  // O cron é de hora em hora, mas o agendador do Actions atrasa e pula: na
  // prática roda a cada 3–6h. Mais de 6h sem sucesso já é parada, não atraso
  // — o mesmo limite do botão "Atualizar dados" na barra.
  if (row.atraso_segundos === null || row.atraso_segundos > 6 * 3600) return "atrasado";
  return "ok";
}

export function SyncStatus({ rows }: { rows: SyncRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-xs text-[var(--text-secondary)]">
        Sem informação de sincronização.
      </p>
    );
  }
  return (
    <ul className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
      {rows.map((row) => {
        const e = ESTADOS[estado(row)];
        return (
          <li key={row.recurso} className="flex items-center gap-2">
            <span aria-hidden style={{ color: e.cor }}>
              {e.icone}
            </span>
            <span className="text-[var(--text-primary)]">{row.recurso}</span>
            <span className="text-[var(--text-secondary)]">
              {e.texto} · {formatAtraso(row.atraso_segundos)} ·{" "}
              {formatInt(row.registros_ingeridos)} registros
            </span>
          </li>
        );
      })}
    </ul>
  );
}
