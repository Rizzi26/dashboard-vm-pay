import type { ReactNode } from "react";

/**
 * Superfície de vidro da proposta (cartao()). Título/subtítulo opcionais;
 * `acoes` vai à direita do título. `compacto` é o respiro do celular e de
 * cartões densos (busca + tabela).
 */
export function Cartao({
  titulo,
  subtitulo,
  acoes,
  compacto = false,
  como: Tag = "section",
  id,
  className = "",
  children,
}: {
  titulo?: ReactNode;
  subtitulo?: ReactNode;
  acoes?: ReactNode;
  compacto?: boolean;
  como?: "section" | "article" | "div";
  id?: string;
  className?: string;
  children?: ReactNode;
}) {
  const pad = compacto ? "p-3.5 rounded-[18px] md:p-[18px] md:rounded-[20px]" : "p-4 rounded-[20px] md:p-[22px] md:rounded-[22px]";
  return (
    <Tag id={id} className={`vidro min-w-0 ${pad} ${className}`}>
      {titulo || acoes ? (
        <header className="mb-3.5 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            {titulo ? <h2 className="m-0 text-[17px] font-semibold text-texto">{titulo}</h2> : null}
            {subtitulo ? <p className="mt-0.5 text-[13px] text-sec">{subtitulo}</p> : null}
          </div>
          {acoes ? <div className="flex flex-wrap gap-2">{acoes}</div> : null}
        </header>
      ) : null}
      {children}
    </Tag>
  );
}
