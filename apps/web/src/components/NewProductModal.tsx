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
  /** Ausente quando a conta não usa (ou não deixa ler) categoria de abastecimento. */
  categoria_abastecimento_id: number | null;
  barcode: string | null;
  preco: number | null;
  /** Presente = já entra na prateleira (planograma) da loja, zerado. */
  prateleira?: { capacidade: number; nivel_ideal: number; nivel_alerta: number } | null;
};

export function NewProductModal({
  onClose,
  loadRefs,
  onSubmit,
  initialNome = "",
  aviso,
  naPrateleira = false,
}: {
  onClose: () => void;
  loadRefs: () => Promise<ProductRefs>;
  onSubmit: (body: NewProductBody) => Promise<void>;
  initialNome?: string;
  aviso?: string;
  /** Há uma loja escolhida: oferece já pôr o produto na prateleira dela (marcado). */
  naPrateleira?: boolean;
}) {
  const [refs, setRefs] = useState<ProductRefs | null>(null);
  const [refsErro, setRefsErro] = useState<string | null>(null);
  const [nome, setNome] = useState(initialNome);
  const [barcode, setBarcode] = useState("");
  const [preco, setPreco] = useState("");
  const [fabricante, setFabricante] = useState("");
  const [categoria, setCategoria] = useState("");
  const [abastecimento, setAbastecimento] = useState("");
  const [prateleira, setPrateleira] = useState(naPrateleira);
  const [niveis, setNiveis] = useState({ capacidade: "", nivel_ideal: "", nivel_alerta: "" });
  const [erro, setErro] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadRefs()
      .then((r) => {
        setRefs(r);
        // Os níveis que a loja já usa, para ninguém precisar adivinhar.
        const p = r.padroes ?? { capacidade: 100, nivel_ideal: 20, nivel_alerta: 3 };
        setNiveis({
          capacidade: String(p.capacidade),
          nivel_ideal: String(p.nivel_ideal),
          nivel_alerta: String(p.nivel_alerta),
        });
      })
      .catch((e) =>
        setRefsErro(e instanceof Error ? e.message : "falha ao carregar os cadastros"),
      );
  }, [loadRefs]);

  async function confirmar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // A VMpay só exige a de abastecimento quando a conta usa mais de uma.
    const exigeAbastecimento = (refs?.categorias_abastecimento.length ?? 0) > 1;
    if (!nome.trim() || !fabricante || !categoria || (exigeAbastecimento && !abastecimento)) {
      setErro(exigeAbastecimento ? "Preencha nome, fabricante e as duas categorias." : "Preencha nome, fabricante e categoria.");
      return;
    }
    const precoNum = preco.trim() ? Number(preco.replace(",", ".")) : null;
    if (precoNum !== null && (!Number.isFinite(precoNum) || precoNum <= 0)) {
      setErro("Preço, se informado, precisa ser maior que zero.");
      return;
    }
    let naLoja: NewProductBody["prateleira"] = null;
    if (prateleira) {
      if (precoNum === null) {
        setErro("Para entrar na prateleira, informe o preço de venda.");
        return;
      }
      const [capacidade, nivel_ideal, nivel_alerta] = [niveis.capacidade, niveis.nivel_ideal, niveis.nivel_alerta].map(
        (v) => Number(v.replace(",", ".")),
      );
      if ([capacidade, nivel_ideal, nivel_alerta].some((n) => !Number.isFinite(n) || n < 0)) {
        setErro("Capacidade e níveis precisam ser números de zero para cima.");
        return;
      }
      if (nivel_ideal > capacidade || nivel_alerta > nivel_ideal) {
        setErro("Os níveis precisam seguir: alerta ≤ ideal ≤ capacidade.");
        return;
      }
      naLoja = { capacidade, nivel_ideal, nivel_alerta };
    }
    setBusy(true);
    setErro(null);
    try {
      await onSubmit({
        nome: nome.trim(),
        fabricante_id: Number(fabricante),
        categoria_id: Number(categoria),
        categoria_abastecimento_id: abastecimento
          ? Number(abastecimento)
          : refs?.categorias_abastecimento.length === 1
            ? refs.categorias_abastecimento[0].id
            : null,
        barcode: barcode.trim() || null,
        preco: precoNum,
        prateleira: naLoja,
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
          // Com uma só (ou nenhuma visível), não há o que escolher.
          ...(refs.categorias_abastecimento.length > 1
            ? ([["Categoria de abastecimento", abastecimento, setAbastecimento, refs.categorias_abastecimento]] as [
                string,
                string,
                (v: string) => void,
                { id: number; nome: string }[],
              ][])
            : []),
        ]
      : [];

  return (
    <Folha
      titulo="Adicionar produto"
      subtitulo={
        aviso ??
        (prateleira
          ? "O produto entra no cadastro da VMpay e na prateleira desta loja, zerado — pronto para a carga."
          : "O produto entra só no cadastro da VMpay: não aparece em loja nenhuma até entrar numa prateleira.")
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
          {prateleira ? "Preço de venda (R$)" : "Preço sugerido (R$)"}
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

      {naPrateleira ? (
        <div className="mt-4 rounded-2xl border border-borda bg-lista px-3.5 py-3">
          <label className="flex items-center gap-2 text-[15px] text-texto">
            <input type="checkbox" checked={prateleira} onChange={(e) => setPrateleira(e.target.checked)} />
            Colocar na prateleira desta loja
          </label>
          {prateleira ? (
            <div className="mt-2 grid grid-cols-3 gap-2">
              {(
                [
                  ["capacidade", "Capacidade"],
                  ["nivel_ideal", "Nível ideal"],
                  ["nivel_alerta", "Alerta"],
                ] as const
              ).map(([chave, rotulo]) => (
                <label key={chave} className={ROTULO_CAMPO}>
                  {rotulo}
                  <input
                    inputMode="numeric"
                    value={niveis[chave]}
                    onChange={(e) => setNiveis((n) => ({ ...n, [chave]: e.target.value }))}
                    className={CAMPO}
                  />
                </label>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

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
