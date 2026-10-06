import { Tile } from "@/components/ui/Tile";

/**
 * API antiga sobre o Tile novo — vários lugares usam StatTile (StockView usa
 * onClick como filtro). Tela nova usa Tile direto, que aceita ícone e
 * `destaque`.
 */
export function StatTile({
  label,
  value,
  hint,
  tone,
  onClick,
  active,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "critical" | "warning";
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <Tile
      rotulo={label}
      valor={value}
      dica={hint}
      tom={tone === "critical" ? "critico" : tone === "warning" ? "alerta" : undefined}
      onClick={onClick}
      ativo={active}
    />
  );
}
