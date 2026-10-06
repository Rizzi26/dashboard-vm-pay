"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Selo } from "@/components/ui/Selo";

export type ProdutoOpcao = { id: string; name: string; barcode: string | null };

const MAX_RESULTADOS = 8;

/** Sem acento, maiúsculo, em palavras — o mesmo critério da sugestão no backend. */
function palavras(texto: string): string[] {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
}

/**
 * Busca de produto por palavras com prefixo: "pres sea" acha "PRESUNTO
 * COZIDO FATIADO SEARA". Um <select> com ~900 itens não é escolha, é rolagem.
 */
export function ProductPicker({
  produtos,
  value,
  sugestoes,
  destacado,
  lembrado,
  rotulo,
  onChange,
  onCadastrar,
}: {
  produtos: ProdutoOpcao[];
  value: string;
  sugestoes: string[];
  destacado?: boolean;
  /** Vínculo que veio do de-para (fornecedor, código): mostra o selo "lembrado". */
  lembrado?: boolean;
  /** aria-label do campo de busca (o rótulo visível fica fora do componente). */
  rotulo?: string;
  onChange: (id: string) => void;
  onCadastrar: () => void;
}) {
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listaId = useId();

  const indice = useMemo(
    () => produtos.map((p) => ({ ...p, palavras: palavras(p.name) })),
    [produtos],
  );
  const porId = useMemo(() => new Map(produtos.map((p) => [p.id, p])), [produtos]);

  const resultados = useMemo(() => {
    const termos = palavras(busca);
    if (termos.length === 0) {
      return sugestoes.map((id) => porId.get(id)).filter((p): p is ProdutoOpcao => !!p);
    }
    const digitos = busca.replace(/\D/g, "");
    return indice
      .filter(
        (p) =>
          termos.every((t) => p.palavras.some((w) => w.startsWith(t))) ||
          (digitos.length >= 4 && (p.barcode ?? "").includes(digitos)),
      )
      .slice(0, MAX_RESULTADOS);
  }, [busca, indice, porId, sugestoes]);

  const selecionado = value ? porId.get(value) : undefined;

  function escolher(id: string) {
    onChange(id);
    setBusca("");
    setAberto(false);
  }

  if (selecionado) {
    return (
      <div className="flex min-h-11 items-center justify-between gap-2 rounded-xl border border-campo-borda bg-campo px-3 md:min-h-10">
        <span className="min-w-0 flex-1 truncate text-[15px] text-texto md:text-[14px]">{selecionado.name}</span>
        {lembrado ? (
          <Selo tom="azul" simbolo={null}>
            lembrado
          </Selo>
        ) : null}
        <button
          type="button"
          onClick={() => {
            onChange("");
            setAberto(true);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
          className="-mr-1 inline-flex min-h-11 shrink-0 items-center px-1 text-[13px] text-azul-texto md:min-h-0"
        >
          trocar
        </button>
      </div>
    );
  }

  // +1: a última opção da lista é sempre "cadastrar produto novo".
  const total = resultados.length + 1;

  return (
    <div className="relative">
      <input
        ref={inputRef}
        value={busca}
        onChange={(e) => {
          setBusca(e.target.value);
          setAtivo(0);
          setAberto(true);
        }}
        onFocus={() => setAberto(true)}
        onBlur={() => setAberto(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setAtivo((a) => (a + 1) % total);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setAtivo((a) => (a - 1 + total) % total);
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (ativo < resultados.length) escolher(resultados[ativo].id);
            else onCadastrar();
          } else if (e.key === "Escape") {
            setAberto(false);
          }
        }}
        placeholder="Buscar produto…"
        aria-label={rotulo ?? "Buscar produto por nome ou código de barras"}
        role="combobox"
        aria-expanded={aberto}
        aria-controls={listaId}
        aria-autocomplete="list"
        // Item sem produto fica laranja: é o que segura a aprovação.
        className={`h-11 w-full rounded-xl px-3 text-base text-texto placeholder:text-terc focus:outline-none focus:ring-2 focus:ring-azul md:h-10 md:text-[14px] ${
          destacado ? "border-[1.5px] border-laranja-borda bg-laranja-campo" : "border border-campo-borda bg-campo"
        }`}
      />
      {aberto ? (
        <ul
          id={listaId}
          role="listbox"
          // mousedown antes do blur: sem isso o clique fecha a lista antes de escolher
          onMouseDown={(e) => e.preventDefault()}
          className="absolute left-0 right-0 z-20 mt-1 max-h-72 overflow-y-auto rounded-xl border border-solido-borda bg-solido py-1 shadow-vidro"
        >
          {!busca.trim() && resultados.length > 0 ? (
            <li className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-sec">
              Sugestões
            </li>
          ) : null}
          {resultados.map((p, i) => (
            <li
              key={p.id}
              role="option"
              aria-selected={i === ativo}
              onClick={() => escolher(p.id)}
              className={`flex min-h-11 cursor-pointer items-center px-3 py-2 text-[14px] text-texto md:min-h-0 ${
                i === ativo ? "bg-azul-tinta" : ""
              }`}
            >
              {p.name}
              {p.barcode ? (
                <span className="ml-2 text-xs text-sec">{p.barcode}</span>
              ) : null}
            </li>
          ))}
          {busca.trim() && resultados.length === 0 ? (
            <li className="px-3 py-2 text-[14px] text-sec">Nenhum produto com esse nome.</li>
          ) : null}
          <li
            role="option"
            aria-selected={ativo === resultados.length}
            onClick={onCadastrar}
            className={`flex min-h-11 cursor-pointer items-center border-t border-sep px-3 py-2 text-[14px] font-medium text-azul-texto md:min-h-0 ${
              ativo === resultados.length ? "bg-azul-tinta" : ""
            }`}
          >
            + Cadastrar produto novo
          </li>
        </ul>
      ) : null}
    </div>
  );
}
