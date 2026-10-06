import { Segmentado } from "@/components/ui/Segmentado";
import { PERIODOS } from "@/lib/periodos";

type Params = Record<string, string | string[] | undefined>;

/** Link de um período mantendo o resto da URL (loja, filtros). 30 é o padrão e sai da URL. */
function hrefPeriodo(basePath: string, chave: string, params: Params): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (k === "periodo" || v === undefined) continue;
    for (const item of Array.isArray(v) ? v : [v]) q.append(k, item);
  }
  if (chave !== "30") q.set("periodo", chave);
  const s = q.toString();
  return s ? `${basePath}?${s}` : basePath;
}

/**
 * Segmentado de período — neutro de propósito: cor fica para dados e ações.
 * A seleção viaja pela URL, não por estado, então cada opção é um link.
 */
export function PeriodoNav({
  basePath,
  periodo,
  params = {},
  largo = false,
  className = "",
}: {
  basePath: string;
  periodo: string;
  /** searchParams atuais, para a troca de período não perder o resto. */
  params?: Params;
  largo?: boolean;
  className?: string;
}) {
  return (
    <Segmentado
      rotulo="Período"
      valor={periodo}
      largo={largo}
      className={className}
      opcoes={PERIODOS.map((p) => ({
        valor: p.key,
        rotulo: p.label,
        href: hrefPeriodo(basePath, p.key, params),
      }))}
    />
  );
}
