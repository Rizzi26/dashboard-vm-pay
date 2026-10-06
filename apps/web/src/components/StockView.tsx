"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ProductRefs, StockRow } from "@/lib/api";
import { browserApi } from "@/lib/api";
import { ExportCsvButton } from "@/components/ExportCsvButton";
import { NewProductModal } from "@/components/NewProductModal";
import { Paginacao } from "@/components/Paginacao";
import { Botao } from "@/components/ui/Botao";
import { Cartao } from "@/components/ui/Cartao";
import { CAMPO, Folha, ROTULO_CAMPO, RodapeFolha } from "@/components/ui/Folha";
import { IconeBusca, IconeMaisSinal } from "@/components/ui/icones";
import { LinhaLista, Lista } from "@/components/ui/Lista";
import { Segmentado } from "@/components/ui/Segmentado";
import { Tile } from "@/components/ui/Tile";
import { Titulo } from "@/components/ui/Titulo";
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

// "acoes" é a folha do celular: a linha da lista não tem espaço para os
// botões Repor/Preço, então o toque abre as ações (e o link da ficha).
type Modal = RowModal | { kind: "acoes"; row: StockRow } | { kind: "new" } | null;

export function StockView({
  rows,
  org,
  role,
  initialDisp,
  initialBusca,
  loja = null,
  sobretitulo,
}: {
  rows: StockRow[];
  org: string;
  role: string;
  initialDisp?: "com" | "sem";
  initialBusca?: string;
  /** Loja escolhida na barra: decide em qual conta VMpay o produto é cadastrado. */
  loja?: string | null;
  /** "Lida há X" — calculado no servidor, onde o "agora" é estável. */
  sobretitulo?: React.ReactNode;
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

  // Com "todas as lojas" o mesmo produto aparece uma vez por local — só aí o
  // nome do local precisa aparecer para as linhas não parecerem duplicadas.
  const variosLocais = useMemo(() => new Set(rows.map((r) => r.location_id)).size > 1, [rows]);

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
    const resp = await browserApi.request(
      `/orgs/${org}/products/refs${loja ? `?loja=${loja}` : ""}`,
      await token(),
    );
    const payload = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(payload.detail ?? `backend respondeu ${resp.status}`);
    }
    return payload as ProductRefs;
  }, [org, loja]);

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

  const titulo = (
    <Titulo
      sobretitulo={sobretitulo}
      titulo="Prateleira"
      subtitulo="O que está exposto em cada loja agora."
      acoes={
        <>
          {/* Invólucro com o hidden: Botao já traz inline-flex, e dois
              display na mesma classe dependem da ordem do CSS. */}
          <span className="hidden items-start gap-2.5 md:flex">
            <ExportCsvButton path={`/orgs/${org}/stock/export.csv`} filename="prateleira.csv" />
            {canOperate ? (
              <Botao variante="cheio" onClick={() => setModal({ kind: "new" })}>
                Adicionar produto
              </Botao>
            ) : null}
          </span>
          {canOperate ? (
            <button
              type="button"
              aria-label="Adicionar produto"
              onClick={() => setModal({ kind: "new" })}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full border-0 bg-azul-tinta text-azul-texto md:hidden"
            >
              <IconeMaisSinal tamanho={22} espessura={2.4} />
            </button>
          ) : null}
        </>
      }
    />
  );

  if (rows.length === 0) {
    return (
      <>
        {titulo}
        <p className="rounded-2xl border border-dashed border-tracejado p-8 text-center text-[15px] text-sec">
          A prateleira ainda não foi sincronizada com a VMpay. Os dados aparecem após
          a primeira sincronização.
        </p>
      </>
    );
  }

  const saldo = (r: StockRow, tamanho: string) =>
    r.quantidade === 0 ? (
      <span className={`font-semibold text-vermelho-texto ${tamanho}`}>
        <span aria-hidden="true">■ </span>0<span className="sr-only"> — zerado</span>
      </span>
    ) : (
      <span className={`font-semibold tabular-nums text-texto ${tamanho}`}>{formatInt(r.quantidade)}</span>
    );
  const preco = (r: StockRow) => (r.preco !== null ? formatMoney(r.preco) : "—");

  return (
    <>
      {titulo}

      {/* No celular os tiles saem (cel_prateleira): a contagem de zerados
          vai no próprio segmentado, que é o filtro. */}
      <div className="hidden grid-cols-2 gap-4 md:grid lg:grid-cols-4">
        <Tile rotulo="Unidades na prateleira" valor={formatInt(tiles.unidades)} />
        <Tile
          rotulo="Valor exposto"
          valor={formatMoney(tiles.valor)}
          dica="a preço de venda; itens sem preço conhecido ficam de fora"
        />
        <Tile
          rotulo="Com saldo"
          valor={formatInt(tiles.disponiveis)}
          onClick={() => filtrar(disponibilidade === "com" ? "todos" : "com")}
          ativo={disponibilidade === "com"}
        />
        <Tile
          rotulo={tiles.ruptura > 0 ? "■ Zerados" : "Zerados"}
          valor={formatInt(tiles.ruptura)}
          destaque={tiles.ruptura > 0}
          dica={disponibilidade === "sem" ? "mostrando só os zerados" : undefined}
          onClick={() => filtrar(disponibilidade === "sem" ? "todos" : "sem")}
          ativo={disponibilidade === "sem"}
        />
      </div>

      {feedback ? (
        <div
          role="status"
          className="flex items-start justify-between gap-3 rounded-2xl border border-borda bg-lista px-4 py-3 text-[15px] text-texto"
        >
          <span className="min-w-0">{feedback}</span>
          <Botao variante="texto" tamanho="p" onClick={() => setFeedback(null)}>
            Fechar
          </Botao>
        </div>
      ) : null}

      {/* No celular não há cartão: busca, segmentado e lista direto no fundo,
          como em cel_prateleira — os utilitários max-md: desligam o vidro. */}
      <Cartao
        compacto
        className="max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:p-0 max-md:shadow-none max-md:backdrop-blur-none"
      >
        <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center md:justify-between">
          <label className="flex h-11 items-center gap-2 rounded-xl bg-trilho px-3 text-sec md:h-10 md:min-w-[280px] md:flex-1">
            <IconeBusca tamanho={16} espessura={2.2} />
            <span className="sr-only">Buscar</span>
            <input
              type="search"
              placeholder="Buscar produto ou código de barras"
              value={filtro}
              onChange={(e) => {
                setFiltro(e.target.value);
                setPagina(0);
              }}
              className="min-w-0 flex-1 border-0 bg-transparent text-[16px] text-texto outline-none placeholder:text-terc md:text-[15px]"
            />
          </label>
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <Segmentado
              rotulo="Disponibilidade"
              valor={disponibilidade}
              onMudar={(v) => filtrar(v as "todos" | "com" | "sem")}
              largo
              className="md:inline-flex md:w-auto"
              opcoes={[
                {
                  valor: "todos",
                  rotulo: (
                    <>
                      Todos<span className="tabular-nums md:hidden"> · {formatInt(contagens.todos)}</span>
                    </>
                  ),
                },
                { valor: "com", rotulo: "Com saldo" },
                {
                  valor: "sem",
                  rotulo: (
                    <>
                      Zerados<span className="tabular-nums md:hidden"> · {formatInt(contagens.sem)}</span>
                    </>
                  ),
                },
              ]}
            />
            <label className="flex items-center justify-end gap-2 text-[13px] text-sec">
              Ordenar
              <select
                value={ordem}
                onChange={(e) => {
                  setOrdem(e.target.value as typeof ordem);
                  setPagina(0);
                }}
                className="h-11 rounded-xl border border-campo-borda bg-campo px-2.5 text-[16px] text-texto md:h-10 md:text-[14px]"
              >
                <option value="nome">Nome (A–Z)</option>
                <option value="qtd-desc">Saldo: maior → menor</option>
                <option value="qtd-asc">Saldo: menor → maior</option>
              </select>
            </label>
          </div>
        </div>

        {filtrados.length === 0 ? (
          <p className="mt-4 text-[15px] text-sec">Nenhum item encontrado</p>
        ) : (
          <>
            {/* Celular: Lista de LinhaLista. Quem opera toca e abre as ações;
                quem só lê vai direto para a ficha. */}
            <Lista rotulo="Produtos na prateleira" className="mt-3 md:hidden">
              {visiveis.map((r) => (
                <LinhaLista
                  key={`${r.location_id}:${r.product_id}`}
                  principal={r.produto}
                  secundario={
                    <>
                      {preco(r)} · {r.barcode ?? "sem código"}
                      {variosLocais ? <> · {r.local}</> : null}
                    </>
                  }
                  direita={saldo(r, "text-[16px]")}
                  href={canOperate ? undefined : `/produto/${r.product_id}`}
                  onClick={canOperate ? () => setModal({ kind: "acoes", row: r }) : undefined}
                />
              ))}
            </Lista>

            <div className="mt-3.5 hidden overflow-hidden rounded-[14px] bg-lista md:block">
              <table className="w-full border-collapse text-[15px]">
                <thead>
                  <tr className="text-left text-[12px] font-semibold uppercase tracking-[0.03em] text-sec">
                    <th scope="col" className="px-4 py-2.5 font-semibold">Produto</th>
                    <th scope="col" className="w-[150px] px-3 py-2.5 font-semibold">Código</th>
                    <th scope="col" className="w-[110px] px-3 py-2.5 text-right font-semibold">Preço</th>
                    <th scope="col" className="w-[100px] px-3 py-2.5 text-right font-semibold">Saldo</th>
                    {canOperate ? (
                      <th scope="col" className="w-[170px] px-4 py-2.5 text-right font-semibold">Ações</th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {visiveis.map((r) => (
                    <tr
                      key={`${r.location_id}:${r.product_id}`}
                      className="border-t border-sep hover:bg-[var(--row-hover)]"
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/produto/${r.product_id}`}
                          className="font-medium text-texto no-underline hover:underline"
                        >
                          {r.produto}
                        </Link>
                        {variosLocais ? <span className="block text-[13px] text-sec">{r.local}</span> : null}
                      </td>
                      <td className="px-3 py-3 text-[13px] tabular-nums text-sec">{r.barcode ?? "—"}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-texto">{preco(r)}</td>
                      <td className="px-3 py-3 text-right">{saldo(r, "")}</td>
                      {canOperate ? (
                        <td className="px-4 py-2">
                          <span className="flex justify-end gap-1.5">
                            <Botao
                              tamanho="p"
                              onClick={() => setModal({ kind: "restock", row: r })}
                              aria-label={`Repor ${r.produto}`}
                            >
                              Repor
                            </Botao>
                            <Botao
                              variante="texto"
                              tamanho="p"
                              onClick={() => setModal({ kind: "price", row: r })}
                              aria-label={`Alterar preço de ${r.produto}`}
                            >
                              Preço
                            </Botao>
                          </span>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Paginacao
              pagina={paginaAtual}
              totalPaginas={totalPaginas}
              total={filtrados.length}
              porPagina={POR_PAGINA}
              onMudar={setPagina}
            />
          </>
        )}

        {/* O botão de exportar do computador mora no título; no celular o
            topo só tem o "+", então ele desce para o fim da lista. */}
        <div className="mt-3 flex justify-center md:hidden">
          <ExportCsvButton
            path={`/orgs/${org}/stock/export.csv`}
            filename="prateleira.csv"
            variante="texto"
          />
        </div>
      </Cartao>

      {modal?.kind === "new" ? (
        <NewProductModal
          onClose={() => setModal(null)}
          loadRefs={carregarRefs}
          onSubmit={async (body) => {
            await executar(
              "/products",
              { ...body, loja },
              `Produto "${body.nome}" criado no cadastro da VMpay. Para ele aparecer na máquina e na prateleira, inclua-o no planograma da instalação.`,
            );
          }}
        />
      ) : modal?.kind === "acoes" ? (
        <Folha
          titulo={modal.row.produto}
          subtitulo={
            <>
              Saldo {formatInt(modal.row.quantidade)} · {preco(modal.row)} · {modal.row.local}
            </>
          }
          onFechar={() => setModal(null)}
        >
          <div className="flex flex-col gap-2.5">
            <Botao variante="cheio" tamanho="g" largo onClick={() => setModal({ kind: "restock", row: modal.row })}>
              Reabastecer
            </Botao>
            <Botao tamanho="g" largo onClick={() => setModal({ kind: "price", row: modal.row })}>
              Alterar preço
            </Botao>
            <Botao tamanho="g" largo href={`/produto/${modal.row.product_id}`}>
              Ver ficha do produto
            </Botao>
            <Botao variante="texto" tamanho="g" largo onClick={() => setModal(null)}>
              Cancelar
            </Botao>
          </div>
        </Folha>
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
    </>
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

  async function confirmar(e: React.FormEvent<HTMLFormElement>) {
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
    <Folha
      titulo={titulo}
      subtitulo={
        <>
          {modal.row.produto} · {modal.row.local}
        </>
      }
      onFechar={onClose}
      onSubmit={confirmar}
    >
      <label className={ROTULO_CAMPO}>
        {rotulo}
        <input
          autoFocus
          inputMode="decimal"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          className={`${CAMPO} tabular-nums`}
        />
      </label>

      {erro ? (
        <p role="alert" className="mt-3 text-[14px] text-vermelho-texto">
          ■ {erro}
        </p>
      ) : null}

      <RodapeFolha>
        <Botao variante="tingido" tamanho="g" onClick={onClose}>
          Cancelar
        </Botao>
        <Botao type="submit" variante="cheio" tamanho="g" disabled={busy}>
          {busy ? "Enviando…" : "Confirmar"}
        </Botao>
      </RodapeFolha>
    </Folha>
  );
}
