/**
 * Ícones de traço da proposta (viewBox 24, stroke = currentColor). Todos
 * decorativos: quem usa põe o texto ao lado ou um aria-label no controle.
 */
type P = { tamanho?: number; className?: string; espessura?: number };

function Svg({
  tamanho = 20,
  className,
  espessura = 2,
  children,
}: P & { children: React.ReactNode }) {
  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={espessura}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

export const IconeLoja = (p: P) => (
  <Svg {...p}>
    <path d="M3 9l1.5-5h15L21 9" />
    <path d="M4 9v11h16V9" />
    <path d="M9 20v-6h6v6" />
  </Svg>
);
export const IconeVendas = (p: P) => (
  <Svg {...p}>
    <path d="M3 3v18h18" />
    <path d="m7 15 4-4 3 3 5-6" />
  </Svg>
);
export const IconePrateleira = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 10h18M3 15h18" />
  </Svg>
);
export const IconePickList = (p: P) => (
  <Svg {...p}>
    <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10" />
  </Svg>
);
export const IconeMais = (p: P) => (
  <Svg {...p}>
    <circle cx="5" cy="12" r="1.5" />
    <circle cx="12" cy="12" r="1.5" />
    <circle cx="19" cy="12" r="1.5" />
  </Svg>
);
export const IconeAtualizar = (p: P) => (
  <Svg espessura={2.2} {...p}>
    <path d="M21 12a9 9 0 1 1-2.6-6.4" />
    <path d="M21 4v5h-5" />
  </Svg>
);
export const IconeDinheiro = (p: P) => (
  <Svg {...p}>
    <path d="M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </Svg>
);
export const IconeLinhas = (p: P) => (
  <Svg {...p}>
    <path d="M3 7h18M3 12h18M3 17h12" />
  </Svg>
);
export const IconeAlerta = (p: P) => (
  <Svg {...p}>
    <path d="M12 9v4M12 17h.01" />
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
  </Svg>
);
export const IconePessoas = (p: P) => (
  <Svg {...p}>
    <circle cx="9" cy="8" r="4" />
    <path d="M2 21a7 7 0 0 1 14 0" />
  </Svg>
);
export const IconeRelogio = (p: P) => (
  <Svg {...p}>
    <path d="M12 8v4l3 2" />
    <circle cx="12" cy="12" r="9" />
  </Svg>
);
export const IconeCartao = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M3 10h18" />
  </Svg>
);
export const IconeBusca = (p: P) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Svg>
);
export const IconeMaisSinal = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

/** Chevron "›" das linhas de lista: cor --seta, como no iOS. */
export function Chevron({ className = "" }: { className?: string }) {
  return (
    <svg
      width="8"
      height="13"
      viewBox="0 0 8 13"
      fill="none"
      stroke="var(--seta)"
      strokeWidth="2"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      <path d="M1.5 1.5 6.5 6.5l-5 5" />
    </svg>
  );
}
