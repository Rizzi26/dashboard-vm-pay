"use client";

import { useEffect, useState } from "react";
import type { ProductRefs } from "@/lib/api";

/** Cadastro de produto na VMpay — usado pelo estoque e pelo pick list. */
export type NewProductBody = {
  nome: string;
  fabricante_id: number;
  categoria_id: number;
  categoria_abastecimento_id: number;
  barcode: string | null;
  preco: number | null;
};

export function NewProductModal({
  onClose,
  loadRefs,
  onSubmit,
  initialNome = "",
  aviso,
}: {
  onClose: () => void;
  loadRefs: () => Promise<ProductRefs>;
  onSubmit: (body: NewProductBody) => Promise<void>;
  initialNome?: string;
  aviso?: string;
}) {
  const [refs, setRefs] = useState<ProductRefs | null>(null);
  const [refsErro, setRefsErro] = useState<string | null>(null);
  const [nome, setNome] = useState(initialNome);
  const [barcode, setBarcode] = useState("");
  const [preco, setPreco] = useState("");
  const [fabricante, setFabricante] = useState("");
  const [categoria, setCategoria] = useState("");
  const [abastecimento, setAbastecimento] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadRefs()
      .then(setRefs)
      .catch((e) =>
        setRefsErro(e instanceof Error ? e.message : "falha ao carregar os cadastros"),
      );
  }, [loadRefs]);

  async function confirmar(e: React.FormEvent) {
    e.preventDefault();
    if (!nome.trim() || !fabricante || !categoria || !abastecimento) {
      setErro("Preencha nome, fabricante e as duas categorias.");
      return;
    }
    const precoNum = preco.trim() ? Number(preco.replace(",", ".")) : null;
    if (precoNum !== null && (!Number.isFinite(precoNum) || precoNum <= 0)) {
      setErro("Preço, se informado, precisa ser maior que zero.");
      return;
    }
    setBusy(true);
    setErro(null);
    try {
      await onSubmit({
        nome: nome.trim(),
        fabricante_id: Number(fabricante),
        categoria_id: Number(categoria),
        categoria_abastecimento_id: Number(abastecimento),
        barcode: barcode.trim() || null,
        preco: precoNum,
      });
    } catch (err) {
      setErro(err instanceof Error ? err.message : "falha ao criar o produto");
      setBusy(false);
    }
  }

  const selects: [string, string, (v: string) => void, { id: number; nome: string }[]][] =
    refs
      ? [
          ["Fabricante", fabricante, setFabricante, refs.fabricantes],
          ["Categoria", categoria, setCategoria, refs.categorias],
          ["Categoria de abastecimento", abastecimento, setAbastecimento, refs.categorias_abastecimento],
        ]
      : [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Adicionar produto"
      className="fixed inset-0 z-30 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
    >
      <form
        onSubmit={confirmar}
        className="max-h-[90dvh] w-full overflow-y-auto rounded-t-xl border border-[var(--grid)] bg-[var(--surface-1)] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-[var(--shadow-card)] sm:max-w-sm sm:rounded-xl"
      >
        <h2 className="text-base font-semibold text-[var(--text-primary)]">Adicionar produto</h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          {aviso ??
            "O produto entra no cadastro da VMpay. Para aparecer na máquina e no estoque, inclua-o depois no planograma da instalação."}
        </p>

        <label className="mt-4 block text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">
          Nome
          <input
            autoFocus
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            className="mt-1 w-full rounded-md border border-[var(--grid)] bg-transparent px-3 py-2 text-base text-[var(--text-primary)] focus:border-[var(--accent)] sm:text-sm"
          />
        </label>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">
            Código de barras
            <input
              inputMode="numeric"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              className="mt-1 w-full rounded-md border border-[var(--grid)] bg-transparent px-3 py-2 text-base text-[var(--text-primary)] focus:border-[var(--accent)] sm:text-sm"
            />
          </label>
          <label className="block text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">
            Preço sugerido (R$)
            <input
              inputMode="decimal"
              value={preco}
              onChange={(e) => setPreco(e.target.value)}
              className="mt-1 w-full rounded-md border border-[var(--grid)] bg-transparent px-3 py-2 text-base text-[var(--text-primary)] focus:border-[var(--accent)] sm:text-sm"
            />
          </label>
        </div>

        {refsErro ? (
          <p role="alert" className="mt-4 text-sm text-[var(--status-critical)]">
            {refsErro}
          </p>
        ) : refs === null ? (
          <p className="mt-4 text-sm text-[var(--text-secondary)]">
            Carregando os cadastros da VMpay…
          </p>
        ) : (
          selects.map(([rotulo, valor, mudar, opcoes]) => (
            <label
              key={rotulo}
              className="mt-3 block text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]"
            >
              {rotulo}
              <select
                value={valor}
                onChange={(e) => mudar(e.target.value)}
                className="mt-1 w-full rounded-md border border-[var(--grid)] bg-[var(--surface-1)] px-3 py-2 text-base text-[var(--text-primary)] focus:border-[var(--accent)] sm:text-sm"
              >
                <option value="">Selecione…</option>
                {opcoes.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.nome}
                  </option>
                ))}
              </select>
            </label>
          ))
        )}

        {erro ? (
          <p role="alert" className="mt-3 text-sm text-[var(--status-critical)]">
            {erro}
          </p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[var(--grid)] px-4 py-2.5 text-sm text-[var(--text-secondary)]"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={busy || refs === null}
            className="rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-[var(--accent-contrast)] disabled:opacity-60"
          >
            {busy ? "Criando…" : "Criar produto"}
          </button>
        </div>
      </form>
    </div>
  );
}
