"use client";

import { useRouter } from "next/navigation";

/** Nome do cookie que as páginas leem no servidor (lib/org.ts — LOJA_COOKIE). */
const LOJA_COOKIE = "loja";

export function escolherLoja(id: string | null) {
  // Cookie, não URL: a escolha vale em todas as telas sem cada link carregar
  // ?loja=. Um ano; "todas" apaga.
  document.cookie = id
    ? `${LOJA_COOKIE}=${id}; path=/; max-age=31536000; samesite=lax`
    : `${LOJA_COOKIE}=; path=/; max-age=0; samesite=lax`;
}

/**
 * Seletor de loja da barra. Com uma loja só, mostra o nome dela e mais nada —
 * o seletor só aparece quando há escolha a fazer.
 *
 * Uma instância só para os dois tamanhos: no celular é o seletor azul do
 * topo compacto (topo_cel da proposta, alvo de 44px); de md para cima, a
 * linha pequena sob o nome da organização.
 */
export function LojaSelector({
  lojas,
  loja,
}: {
  lojas: { id: string; nome: string }[];
  loja: string | null;
}) {
  const router = useRouter();
  if (lojas.length <= 1) {
    return lojas[0] ? (
      <span className="block truncate text-[15px] font-semibold text-texto md:text-xs md:font-normal md:text-sec">
        {lojas[0].nome}
      </span>
    ) : null;
  }
  return (
    <label className="flex min-h-11 items-center gap-1 text-sec md:min-h-0 md:text-xs">
      <span className="sr-only md:not-sr-only">Loja</span>
      <select
        value={loja ?? ""}
        onChange={(e) => {
          escolherLoja(e.target.value || null);
          router.refresh();
        }}
        className="max-w-[62vw] truncate rounded border-none bg-transparent p-0 text-[15px] font-semibold text-azul-texto md:max-w-56 md:px-0.5 md:text-xs md:font-normal md:text-texto"
      >
        <option value="">Todas as lojas ({lojas.length})</option>
        {lojas.map((l) => (
          <option key={l.id} value={l.id}>
            {l.nome}
          </option>
        ))}
      </select>
    </label>
  );
}
