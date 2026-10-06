import type { ReactNode } from "react";

/**
 * Fundo sólido para gráfico dentro de um Cartao de vidro. Os tokens de série
 * (--series-1, --seq-*) foram validados contra superfície sólida; sobre o
 * blur a cor percebida muda e o contraste deixa de valer. `rolavel` é para o
 * mapa de calor, que no celular rola de lado em vez de espremer.
 */
export function SuperficieGrafico({
  rolavel = false,
  className = "",
  children,
}: {
  rolavel?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`superficie-grafico min-w-0 p-3 ${rolavel ? "overflow-x-auto" : ""} ${className}`}>
      {children}
    </div>
  );
}
