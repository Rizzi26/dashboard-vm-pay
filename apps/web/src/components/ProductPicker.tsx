"use client";

import { useId, useMemo, useRef, useState } from "react";

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
  onChange,
  onCadastrar,
}: {
  produtos: ProdutoOpcao[];
  value: string;
  sugestoes: string[];
  destacado?: boolean;
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
      <div className="mt-0.5 flex items-center justify-between gap-2 rounded-md border border-[var(--grid)] px-2 py-1.5">
        <span className="min-w-0 truncate text-base normal-case tracking-normal text-[var(--text-primary)] sm:text-sm">
          {selecionado.name}
        </span>
        <button
          type="button"
          onClick={() => {
            onChange("");
            setAberto(true);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
          className="shrink-0 text-xs normal-case tracking-normal text-[var(--text-secondary)] underline"
        >
          trocar
        </button>
      </div>
    );
  }

  // +1: a última opção da lista é sempre "cadastrar produto novo".
  const total = resultados.length + 1;

  return (
    <div className="relative mt-0.5">
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
        placeholder="Buscar por nome ou código de barras…"
        role="combobox"
        aria-expanded={aberto}
        aria-controls={listaId}
        aria-autocomplete="list"
        className={`w-full rounded-md border bg-transparent px-2 py-1.5 text-base normal-case tracking-normal text-[var(--text-primary)] focus:border-[var(--accent)] sm:text-sm ${
          destacado ? "border-[var(--status-warning)]" : "border-[var(--grid)]"
        }`}
      />
      {aberto ? (
        <ul
          id={listaId}
          role="listbox"
          // mousedown antes do blur: sem isso o clique fecha a lista antes de escolher
          onMouseDown={(e) => e.preventDefault()}
          className="absolute left-0 right-0 z-20 mt-1 max-h-72 overflow-y-auto rounded-md border border-[var(--grid)] bg-[var(--surface-1)] py-1 normal-case tracking-normal shadow-[var(--shadow-card)]"
        >
          {!busca.trim() && resultados.length > 0 ? (
            <li className="px-3 pb-1 pt-1.5 text-[11px] uppercase tracking-wide text-[var(--text-secondary)]">
              Sugestões
            </li>
          ) : null}
          {resultados.map((p, i) => (
            <li
              key={p.id}
              role="option"
              aria-selected={i === ativo}
              onClick={() => escolher(p.id)}
              className={`cursor-pointer px-3 py-2 text-sm text-[var(--text-primary)] ${
                i === ativo ? "bg-[var(--row-hover)]" : ""
              }`}
            >
              {p.name}
              {p.barcode ? (
                <span className="ml-2 text-xs text-[var(--text-secondary)]">{p.barcode}</span>
              ) : null}
            </li>
          ))}
          {busca.trim() && resultados.length === 0 ? (
            <li className="px-3 py-2 text-sm text-[var(--text-secondary)]">Nenhum produto com esse nome.</li>
          ) : null}
          <li
            role="option"
            aria-selected={ativo === resultados.length}
            onClick={onCadastrar}
            className={`cursor-pointer border-t border-[var(--grid)] px-3 py-2 text-sm text-[var(--accent)] ${
              ativo === resultados.length ? "bg-[var(--row-hover)]" : ""
            }`}
          >
            + Cadastrar produto novo
          </li>
        </ul>
      ) : null}
    </div>
  );
}
