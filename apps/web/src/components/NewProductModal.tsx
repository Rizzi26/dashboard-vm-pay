"use client";

import { useEffect, useState } from "react";
import { Botao } from "@/components/ui/Botao";
import { CAMPO, Folha, ROTULO_CAMPO, RodapeFolha } from "@/components/ui/Folha";
import type { ProductRefs } from "@/lib/api";

/** Cadastro de produto na VMpay — usado pela Prateleira e pelo pick list. */
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

  async function confirmar(e: React.FormEvent<HTMLFormElement>) {
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
    <Folha
      titulo="Adicionar produto"
      subtitulo={
        aviso ??
        "O produto entra no cadastro da VMpay. Para aparecer na máquina e na prateleira, inclua-o depois no planograma da instalação."
      }
      onFechar={onClose}
      onSubmit={confirmar}
      largura="md:max-w-[480px]"
    >
      <label className={ROTULO_CAMPO}>
        Nome
        <input autoFocus value={nome} onChange={(e) => setNome(e.target.value)} className={CAMPO} />
      </label>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className={ROTULO_CAMPO}>
          Código de barras
          <input
            inputMode="numeric"
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            className={CAMPO}
          />
        </label>
        <label className={ROTULO_CAMPO}>
          Preço sugerido (R$)
          <input
            inputMode="decimal"
            value={preco}
            onChange={(e) => setPreco(e.target.value)}
            className={CAMPO}
          />
        </label>
      </div>

      {refsErro ? (
        <p role="alert" className="mt-4 text-[14px] text-vermelho-texto">
          ■ {refsErro}
        </p>
      ) : refs === null ? (
        <p role="status" className="mt-4 text-[14px] text-sec">
          Carregando os cadastros da VMpay…
        </p>
      ) : (
        selects.map(([rotulo, valor, mudar, opcoes]) => (
          <label key={rotulo} className={`mt-3 ${ROTULO_CAMPO}`}>
            {rotulo}
            <select value={valor} onChange={(e) => mudar(e.target.value)} className={CAMPO}>
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
        <p role="alert" className="mt-3 text-[14px] text-vermelho-texto">
          ■ {erro}
        </p>
      ) : null}

      <RodapeFolha>
        <Botao variante="tingido" tamanho="g" onClick={onClose}>
          Cancelar
        </Botao>
        <Botao type="submit" variante="cheio" tamanho="g" disabled={busy || refs === null}>
          {busy ? "Criando…" : "Criar produto"}
        </Botao>
      </RodapeFolha>
    </Folha>
  );
}
