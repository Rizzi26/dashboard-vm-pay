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
  ok: { cor: "text-verde-texto", icone: "●", texto: "em dia" },
  atrasado: { cor: "text-laranja-texto", icone: "▲", texto: "atrasado" },
  falha: { cor: "text-vermelho-texto", icone: "■", texto: "com falha" },
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
      <p className="m-0 text-[13px] text-sec">
        Sem informação de sincronização.
      </p>
    );
  }
  return (
    <ul className="m-0 flex list-none flex-wrap gap-x-6 gap-y-2 p-0 text-[13px]">
      {rows.map((row) => {
        const e = ESTADOS[estado(row)];
        return (
          <li key={row.recurso} className="flex min-w-0 flex-wrap items-center gap-x-2">
            <span aria-hidden className={e.cor}>
              {e.icone}
            </span>
            <span className="font-medium text-texto">{row.recurso}</span>
            <span className="text-sec">
              <span className={e.cor}>{e.texto}</span>
              {" · "}{formatAtraso(row.atraso_segundos)} ·{" "}
              {formatInt(row.registros_ingeridos)} registros
            </span>
          </li>
        );
      })}
    </ul>
  );
}
