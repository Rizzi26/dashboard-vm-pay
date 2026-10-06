import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Cabeçalho da página (titulo() da proposta): sobretítulo em caixa alta,
 * título grande, subtítulo e ações à direita. No celular é o "título grande"
 * do iOS (34px) logo abaixo do topo compacto da barra — por isso a barra não
 * repete o nome da tela. `voltar` é o "‹ Prateleira" da ficha do produto.
 */
export function Titulo({
  sobretitulo,
  titulo,
  subtitulo,
  acoes,
  voltar,
  className = "",
}: {
  sobretitulo?: ReactNode;
  titulo: ReactNode;
  subtitulo?: ReactNode;
  acoes?: ReactNode;
  voltar?: { href: string; rotulo: string };
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {voltar ? (
        <Link
          href={voltar.href}
          className="inline-flex min-h-11 items-center self-start text-[16px] text-azul-texto no-underline md:min-h-0 md:text-[15px]"
        >
          <span aria-hidden="true">‹&nbsp;</span>
          {voltar.rotulo}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          {sobretitulo ? (
            <p className="m-0 text-[13px] font-semibold uppercase tracking-[0.02em] text-sec">{sobretitulo}</p>
          ) : null}
          <h1 className="m-0 mt-1 break-words text-[34px] font-bold leading-tight tracking-[-0.025em] text-texto md:text-[40px]">
            {titulo}
          </h1>
          {subtitulo ? <p className="m-0 mt-1 text-[15px] text-sec">{subtitulo}</p> : null}
        </div>
        {acoes ? <div className="flex flex-wrap items-center gap-2.5">{acoes}</div> : null}
      </div>
    </div>
  );
}
