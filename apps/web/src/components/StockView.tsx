"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ProductRefs, StockRow } from "@/lib/api";
import { browserApi } from "@/lib/api";
import { StatTile } from "@/components/StatTile";
import { formatInt, formatMoney } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase/browser";

/** A UI esconde ações de quem não pode — e o servidor revalida de qualquer jeito. */
const CAN_OPERATE = new Set(["admin", "master"]);

async function token(): Promise<string> {
  const { data } = await supabaseBrowser().auth.getSession();
  if (!data.session) throw new Error("sessão expirada — entre de novo");
  return data.session.access_token;
}

type RowModal =
  | { kind: "restock"; row: StockRow }
  | { kind: "price"; row: StockRow };

type Modal = RowModal | { kind: "new" } | null;

export function StockView({
  rows,
  org,
  role,
  initialDisp,
  initialBusca,
  quebras,
}: {
  rows: StockRow[];
  org: string;
  role: string;
  initialDisp?: "com" | "sem";
  initialBusca?: string;
  // null = endpoint indisponível (deploy defasado ou erro): o tile some em
  // vez de mostrar zero — zero é uma afirmação, ausência não.
  quebras?: { unidades: number; valor: number } | null;
}) {
  const router = useRouter();
  const [filtro, setFiltro] = useState(initialBusca ?? "");
  const [disponibilidade, setDisponibilidade] = useState<"todos" | "com" | "sem">(
    initialDisp ?? "todos",
  );
  const [ordem, setOrdem] = useState<"nome" | "qtd-desc" | "qtd-asc">("nome");
  const [pagina, setPagina] = useState(0);
  const [modal, setModal] = useState<Modal>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [sincronizando, setSincronizando] = useState(false);

  const canOperate = CAN_OPERATE.has(role);

  // Tiles calculados dos dados que a página já carrega — sem endpoint novo.
  // Na ordem do repositor: primeiro o problema, depois o resto.
  const tiles = useMemo(
    () => ({
      unidades: rows.reduce((s, r) => s + r.quantidade, 0),
      valor: rows.reduce((s, r) => s + r.quantidade * (r.preco ?? 0), 0),
      disponiveis: rows.filter((r) => r.quantidade > 0).length,
      ruptura: rows.filter((r) => r.quantidade === 0).length,
    }),
    [rows],
  );

  const porTexto = useMemo(() => {
    const termo = filtro.trim().toLowerCase();
    if (!termo) return rows;
    return rows.filter(
      (r) =>
        r.produto.toLowerCase().includes(termo) ||
        r.local.toLowerCase().includes(termo) ||
        (r.barcode ?? "").includes(termo),
    );
  }, [rows, filtro]);

  const contagens = useMemo(
    () => ({
      todos: porTexto.length,
      com: porTexto.filter((r) => r.quantidade > 0).length,
      sem: porTexto.filter((r) => r.quantidade === 0).length,
    }),
    [porTexto],
  );

  const filtrados = useMemo(() => {
    let out = porTexto;
    if (disponibilidade === "com") out = out.filter((r) => r.quantidade > 0);
    if (disponibilidade === "sem") out = out.filter((r) => r.quantidade === 0);
    if (ordem !== "nome") {
      out = [...out].sort((a, b) =>
        ordem === "qtd-desc" ? b.quantidade - a.quantidade : a.quantidade - b.quantidade,
      );
    }
    return out;
  }, [porTexto, disponibilidade, ordem]);

  // 1.170 itens numa tabela só é rolagem infinita; 50 por página mantém o
  // filtro global (busca em tudo) e a página curta.
  const POR_PAGINA = 50;
  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA));
  const paginaAtual = Math.min(pagina, totalPaginas - 1);
  const visiveis = filtrados.slice(
    paginaAtual * POR_PAGINA,
    (paginaAtual + 1) * POR_PAGINA,
  );

  function filtrar(disp: "todos" | "com" | "sem") {
    setDisponibilidade(disp);
    setPagina(0);
  }

  const carregarRefs = useCallback(async (): Promise<ProductRefs> => {
    const resp = await browserApi.request(`/orgs/${org}/products/refs`, await token());
    const payload = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(payload.detail ?? `backend respondeu ${resp.status}`);
    }
    return payload as ProductRefs;
  }, [org]);

  async function exportar() {
    try {
      const resp = await browserApi.request(`/orgs/${org}/stock/export.csv`, await token());
      if (!resp.ok) throw new Error(`backend respondeu ${resp.status}`);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "estoque.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "falha na exportação");
    }
  }

  async function atualizarAgora() {
    // O 202 volta na hora; o fim do snapshot aparece como updated_at mais novo
    // no próprio /stock — é isso que o poll espera antes de recarregar.
    try {
      setSincronizando(true);
      setFeedback(null);
      const resp = await browserApi.request(`/orgs/${org}/stock/sync`, await token(), {
        method: "POST",
      });
      const payload = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(payload.detail ?? `backend respondeu ${resp.status}`);
      }
      const antes = rows.reduce((m, r) => Math.max(m, Date.parse(r.atualizado_em)), 0);
      const inicio = Date.now();
      const poll = setInterval(async () => {
        try {
          const r = await browserApi.request(`/orgs/${org}/stock`, await token());
          if (r.ok) {
            const dados = (await r.json()) as StockRow[];
            const depois = dados.reduce((m, x) => Math.max(m, Date.parse(x.atualizado_em)), 0);
            if (depois > antes) {
              clearInterval(poll);
              setSincronizando(false);
              setFeedback("Estoque sincronizado com a VMpay.");
              router.refresh();
              return;
            }
          }
        } catch {
          // erro transitório de rede: o próximo tick tenta de novo
        }
        if (Date.now() - inicio > 180_000) {
          clearInterval(poll);
          setSincronizando(false);
          setFeedback("A sincronização está demorando — recarregue a página em instantes.");
        }
      }, 8000);
    } catch (err) {
      setSincronizando(false);
      setFeedback(err instanceof Error ? err.message : "falha ao sincronizar");
    }
  }

  async function executar(path: string, body: unknown, sucesso: string) {
    const resp = await browserApi.request(`/orgs/${org}${path}`, await token(), {
      method: "POST",
      body: JSON.stringify(body),
    });
    const payload = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(payload.detail ?? `backend respondeu ${resp.status}`);
    }
    setFeedback(sucesso);
    setModal(null);
    router.refresh();
  }

  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-[var(--grid)] p-8 text-center text-sm text-[var(--text-secondary)]">
        O estoque ainda não foi sincronizado com a VMpay. Os dados aparecem após
        a primeira sincronização.
      </p>
    );
  }

  return (
    <div>
      <div
        className={`mb-6 grid grid-cols-2 gap-4 ${
          quebras ? "lg:grid-cols-5" : "lg:grid-cols-4"
        }`}
      >
        {quebras ? (
          <StatTile
            label="Quebra (30d)"
            value={formatInt(quebras.unidades)}
            tone={quebras.unidades > 0 ? "critical" : undefined}
            hint={
              quebras.unidades > 0
                ? `${formatMoney(quebras.valor)} sem venda — toque para ver`
                : "nenhuma queda de saldo sem venda"
            }
            onClick={() => router.push("/quebras")}
          />
        ) : null}
        <StatTile
          label="Em ruptura"
          value={formatInt(tiles.ruptura)}
          tone={tiles.ruptura > 0 ? "critical" : undefined}
          hint={
            tiles.ruptura > 0
              ? "toque para ver a lista"
              : "itens do planograma com saldo zero"
          }
          onClick={() => filtrar("sem")}
          active={disponibilidade === "sem"}
        />
        <StatTile
          label="Produtos disponíveis"
          value={formatInt(tiles.disponiveis)}
          onClick={() => filtrar("com")}
          active={disponibilidade === "com"}
        />
        <StatTile
          label="Unidades em prateleira"
          value={formatInt(tiles.unidades)}
          onClick={() => filtrar("todos")}
          active={disponibilidade === "todos"}
        />
        <StatTile
          label="Valor de prateleira"
          value={formatMoney(tiles.valor)}
          hint="a preço de venda; itens sem preço conhecido ficam de fora"
          onClick={() => filtrar("todos")}
          active={disponibilidade === "todos"}
        />
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <input
          type="search"
          placeholder="Filtrar por produto, local ou código…"
          value={filtro}
          onChange={(e) => {
            setFiltro(e.target.value);
            setPagina(0);
          }}
          className="w-full rounded-md border border-[var(--grid)] bg-transparent px-3 py-1.5 text-base text-[var(--text-primary)] focus:border-[var(--accent)] sm:w-72 sm:text-sm"
        />
        <div className="flex gap-2 self-start sm:self-auto">
          {canOperate ? (
            <>
              <button
                type="button"
                onClick={atualizarAgora}
                disabled={sincronizando}
                className="whitespace-nowrap rounded-md border border-[var(--grid)] px-3 py-1.5 text-sm text-[var(--text-primary)] hover:border-[var(--accent)] disabled:cursor-wait disabled:opacity-60"
              >
                {sincronizando ? "Sincronizando…" : "Atualizar"}
              </button>
              <button
                type="button"
                onClick={() => setModal({ kind: "new" })}
                className="whitespace-nowrap rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-contrast)]"
              >
                Adicionar produto
              </button>
            </>
          ) : null}
          <button
            type="button"
            onClick={exportar}
            className="whitespace-nowrap rounded-md border border-[var(--grid)] px-3 py-1.5 text-sm text-[var(--text-primary)] hover:border-[var(--accent)]"
          >
            Exportar CSV
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2" role="group" aria-label="Filtrar por disponibilidade">
          {(
            [
              ["todos", "Todos"],
              ["com", "Com estoque"],
              ["sem", "Em ruptura"],
            ] as const
          ).map(([valor, rotulo]) => (
            <button
              key={valor}
              type="button"
              onClick={() => filtrar(valor)}
              className={
                disponibilidade === valor
                  ? "rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--accent-contrast)]"
                  : "rounded-md border border-[var(--grid)] px-3 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }
            >
              {rotulo} (<span className="tabular-nums">{contagens[valor]}</span>)
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
          Ordenar
          <select
            value={ordem}
            onChange={(e) => {
              setOrdem(e.target.value as typeof ordem);
              setPagina(0);
            }}
            className="rounded-md border border-[var(--grid)] bg-transparent px-2 py-1 text-base text-[var(--text-primary)] sm:text-sm"
          >
            <option value="nome">Nome (A–Z)</option>
            <option value="qtd-desc">Quantidade: maior → menor</option>
            <option value="qtd-asc">Quantidade: menor → maior</option>
          </select>
        </label>
      </div>

      {feedback ? (
        <p
          role="status"
          className="mb-4 rounded-md border border-[var(--grid)] px-3 py-2 text-sm text-[var(--text-primary)]"
        >
          {feedback}
          <button
            type="button"
            className="ml-3 text-xs text-[var(--text-secondary)] underline"
            onClick={() => setFeedback(null)}
          >
            fechar
          </button>
        </p>
      ) : null}

      {/* Lista mobile: mesmos dados da tabela, um card por produto — a
          superfície mais clara separa cada item do fundo da página. */}
      <ul className="space-y-3 md:hidden">
        {visiveis.map((r) => (
          <li
            key={`${r.location_id}:${r.product_id}`}
            className="rounded-xl border border-[var(--grid)] bg-[var(--surface-1)] p-4 shadow-[var(--shadow-card)]"
          >
            <div className="flex items-start justify-between gap-3">
              <Link
                href={`/produto/${r.product_id}`}
                className="text-sm font-medium text-[var(--text-primary)] underline decoration-[var(--grid)] underline-offset-4 hover:decoration-[var(--series-1)]"
              >
                {r.produto}
              </Link>
              <span
                className={`text-lg font-semibold tabular-nums ${
                  r.quantidade === 0
                    ? "text-[var(--status-critical)]"
                    : "text-[var(--text-primary)]"
                }`}
              >
                {formatInt(r.quantidade)}
              </span>
            </div>
            <p className="text-xs text-[var(--text-secondary)]">
              {r.local} · {r.barcode ?? "sem código"} ·{" "}
              {r.preco !== null ? formatMoney(r.preco) : "—"}
            </p>
            {canOperate ? (
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setModal({ kind: "restock", row: r })}
                  className="min-h-11 flex-1 rounded-lg border border-[var(--grid)] text-sm text-[var(--accent)]"
                >
                  Reabastecer
                </button>
                <button
                  type="button"
                  onClick={() => setModal({ kind: "price", row: r })}
                  className="min-h-11 flex-1 rounded-lg border border-[var(--grid)] text-sm text-[var(--accent)]"
                >
                  Preço
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      <table className="hidden w-full text-sm md:table">
        <thead>
          <tr className="border-b border-[var(--grid)] text-left text-[11px] uppercase tracking-[0.08em] text-[var(--text-secondary)]">
            <th className="py-2.5 font-medium">Produto</th>
            <th className="py-2.5 pl-4 font-medium">Local</th>
            <th className="py-2.5 pl-4 text-right font-medium">Preço</th>
            <th className="py-2.5 pl-4 text-right font-medium">Qtd.</th>
            {canOperate ? <th className="py-2.5 pl-6 text-right font-medium">Ações</th> : null}
          </tr>
        </thead>
        <tbody className="text-[var(--text-primary)]">
          {visiveis.map((r) => (
            <tr
              key={`${r.location_id}:${r.product_id}`}
              className="border-t border-[var(--grid)] hover:bg-[var(--row-hover)]"
            >
              <td className="py-2.5">
                <Link
                  href={`/produto/${r.product_id}`}
                  className="text-[var(--text-primary)] underline decoration-[var(--grid)] underline-offset-4 hover:decoration-[var(--series-1)]"
                >
                  {r.produto}
                </Link>
                {r.barcode ? (
                  <span className="ml-2 text-xs text-[var(--text-secondary)]">{r.barcode}</span>
                ) : null}
              </td>
              <td className="py-2.5 pl-4 text-[var(--text-secondary)]">{r.local}</td>
              <td className="py-2.5 pl-4 text-right tabular-nums">
                {r.preco !== null ? formatMoney(r.preco) : "—"}
              </td>
              <td className="py-2.5 pl-4 text-right tabular-nums">{formatInt(r.quantidade)}</td>
              {canOperate ? (
                <td className="py-2.5 pl-6 text-right">
                  <div className="flex justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => setModal({ kind: "restock", row: r })}
                      className="whitespace-nowrap rounded-md border border-[var(--grid)] px-2.5 py-1 text-xs text-[var(--accent)] hover:border-[var(--accent)]"
                    >
                      Repor
                    </button>
                    <button
                      type="button"
                      onClick={() => setModal({ kind: "price", row: r })}
                      className="whitespace-nowrap rounded-md border border-[var(--grid)] px-2.5 py-1 text-xs text-[var(--accent)] hover:border-[var(--accent)]"
                    >
                      Preço
                    </button>
                  </div>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-4 flex flex-col gap-2 text-sm text-[var(--text-secondary)] sm:flex-row sm:items-center sm:justify-between">
        <span>
          {filtrados.length === 0
            ? "Nenhum item encontrado"
            : `${paginaAtual * POR_PAGINA + 1}–${Math.min(
                (paginaAtual + 1) * POR_PAGINA,
                filtrados.length,
              )} de ${filtrados.length} itens`}
        </span>
        {totalPaginas > 1 ? (
          <span className="flex items-center gap-2">
            <button
              type="button"
              disabled={paginaAtual === 0}
              onClick={() => setPagina(paginaAtual - 1)}
              className="rounded-md border border-[var(--grid)] px-4 py-2 disabled:opacity-40"
            >
              ← Anterior
            </button>
            <span className="tabular-nums">
              {paginaAtual + 1}/{totalPaginas}
            </span>
            <button
              type="button"
              disabled={paginaAtual >= totalPaginas - 1}
              onClick={() => setPagina(paginaAtual + 1)}
              className="rounded-md border border-[var(--grid)] px-4 py-2 disabled:opacity-40"
            >
              Próxima →
            </button>
          </span>
        ) : null}
      </div>

      {modal?.kind === "new" ? (
        <NewProductModal
          onClose={() => setModal(null)}
          loadRefs={carregarRefs}
          onSubmit={async (body) => {
            await executar(
              "/products",
              body,
              `Produto "${body.nome}" criado no cadastro da VMpay. Para ele aparecer na máquina e no estoque, inclua-o no planograma da instalação.`,
            );
          }}
        />
      ) : modal ? (
        <ActionModal
          modal={modal}
          onClose={() => setModal(null)}
          onSubmit={async (valor) => {
            if (modal.kind === "restock") {
              await executar(
                "/stock/restock",
                {
                  location_id: modal.row.location_id,
                  items: [{ product_id: modal.row.product_id, quantity: valor }],
                },
                `Reabastecimento de ${valor}× ${modal.row.produto} enviado à VMpay.`,
              );
            } else {
              await executar(
                "/stock/price",
                {
                  location_id: modal.row.location_id,
                  product_id: modal.row.product_id,
                  price: valor,
                },
                `Preço de ${modal.row.produto} atualizado na VMpay.`,
              );
            }
          }}
        />
      ) : null}
    </div>
  );
}

function ActionModal({
  modal,
  onClose,
  onSubmit,
}: {
  modal: RowModal;
  onClose: () => void;
  onSubmit: (valor: number) => Promise<void>;
}) {
  const [valor, setValor] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const restock = modal.kind === "restock";
  const titulo = restock ? "Reabastecer" : "Alterar preço";
  const rotulo = restock ? "Quantidade recebida" : "Novo preço (R$)";

  async function confirmar(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(valor.replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) {
      setErro("Informe um número maior que zero.");
      return;
    }
    setBusy(true);
    setErro(null);
    try {
      await onSubmit(n);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "falha na ação");
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={titulo}
      className="fixed inset-0 z-30 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
    >
      <form
        onSubmit={confirmar}
        className="w-full rounded-t-xl border border-[var(--grid)] bg-[var(--surface-1)] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-[var(--shadow-card)] sm:max-w-sm sm:rounded-xl"
      >
        <h2 className="text-base font-semibold text-[var(--text-primary)]">{titulo}</h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          {modal.row.produto} · {modal.row.local}
        </p>

        <label className="mt-4 block text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">
          {rotulo}
          <input
            autoFocus
            inputMode="decimal"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            className="mt-1 w-full rounded-md border border-[var(--grid)] bg-transparent px-3 py-2 text-base text-[var(--text-primary)] focus:border-[var(--accent)] sm:text-sm"
          />
        </label>

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
            disabled={busy}
            className="rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-[var(--accent-contrast)] disabled:opacity-60"
          >
            {busy ? "Enviando…" : "Confirmar"}
          </button>
        </div>
      </form>
    </div>
  );
}

type NewProductBody = {
  nome: string;
  fabricante_id: number;
  categoria_id: number;
  categoria_abastecimento_id: number;
  barcode: string | null;
  preco: number | null;
};

function NewProductModal({
  onClose,
  loadRefs,
  onSubmit,
}: {
  onClose: () => void;
  loadRefs: () => Promise<ProductRefs>;
  onSubmit: (body: NewProductBody) => Promise<void>;
}) {
  const [refs, setRefs] = useState<ProductRefs | null>(null);
  const [refsErro, setRefsErro] = useState<string | null>(null);
  const [nome, setNome] = useState("");
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
          O produto entra no cadastro da VMpay. Para aparecer na máquina e no
          estoque, inclua-o depois no planograma da instalação.
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
