"use client";

import { useCallback, useMemo, useState } from "react";
import type { PicklistOpcoes, ProductRefs } from "@/lib/api";
import { browserApi } from "@/lib/api";
import { NewProductModal } from "@/components/NewProductModal";
import { ProductPicker } from "@/components/ProductPicker";
import { Aviso, CAMPO, ConfrontoReposicao, detalheDoErro, num, token, valido } from "@/components/picklist-comum";
import { Botao } from "@/components/ui/Botao";
import { Cartao } from "@/components/ui/Cartao";
import { Titulo } from "@/components/ui/Titulo";
import { formatInt } from "@/lib/format";

type Produto = PicklistOpcoes["produtos"][number];

/** Quantidade como texto enquanto o operador digita ("1," é válido no meio). */
type Linha = { product_id: string; quantidade: string; novo?: boolean };

/** "87,40" ou "87.40"; vazio é "não informado". */
function valorInformado(s: string): { ok: boolean; valor: string | null } {
  const t = s.trim();
  if (!t) return { ok: true, valor: null };
  const limpo = t.replace(/^R\$\s*/, "");
  // Com vírgula, o ponto é milhar ("1.087,40"); sem vírgula, é decimal ("87.40").
  const n = Number(limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo);
  return Number.isFinite(n) && n >= 0 ? { ok: true, valor: n.toFixed(2) } : { ok: false, valor: null };
}

/**
 * Carga manual: a compra que não tem cupom legível (contingência recusada,
 * nota de papel do atacado, sem nota) entra montada à mão — só os produtos do
 * sistema e a quantidade. Vira um recibo "avulso" no mesmo histórico dos
 * cupons, pelo mesmo restock com action_log.
 */
export function CargaManual({
  org,
  opcoes,
  localInicial,
  onProdutoCadastrado,
  onCancelar,
  onLancada,
}: {
  org: string;
  opcoes: PicklistOpcoes;
  localInicial: string;
  onProdutoCadastrado: (p: Produto) => void;
  onCancelar: () => void;
  onLancada: (unidades: number) => void;
}) {
  const [localId, setLocalId] = useState(localInicial || (opcoes.locais.length === 1 ? opcoes.locais[0].id : ""));
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [fornecedor, setFornecedor] = useState("");
  const [valor, setValor] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ultimo, setUltimo] = useState<string | null>(null);
  const [cadastrando, setCadastrando] = useState(false);

  // Várias contas VMpay: só os produtos da conta da loja — produto de outra
  // conta a VMpay recusaria na carga.
  const contaDaLoja = opcoes.locais.find((l) => l.id === localId)?.conta ?? null;
  const produtosDaLoja = useMemo(
    () => (contaDaLoja ? opcoes.produtos.filter((p) => !p.conta || p.conta === contaDaLoja) : opcoes.produtos),
    [opcoes.produtos, contaDaLoja],
  );
  const porId = useMemo(() => new Map(opcoes.produtos.map((p) => [p.id, p])), [opcoes.produtos]);
  const daLoja = useMemo(() => new Set(produtosDaLoja.map((p) => p.id)), [produtosDaLoja]);
  // Com mais de uma conta, a busca só faz sentido depois da loja: antes dela
  // a lista misturaria produtos que a loja não pode receber.
  const variasContas = new Set(opcoes.locais.map((l) => l.conta).filter(Boolean)).size > 1;
  const precisaLoja = variasContas && !localId;

  function adicionar(id: string, novo = false) {
    const nome = porId.get(id)?.name ?? "Produto";
    const existente = linhas.find((l) => l.product_id === id);
    if (existente) {
      const agora = (valido(existente.quantidade) ? num(existente.quantidade) : 0) + 1;
      setLinhas((ls) => ls.map((l) => (l.product_id === id ? { ...l, quantidade: String(agora) } : l)));
      setUltimo(`${nome}: somado, agora ${formatInt(agora)} un.`);
    } else {
      // O mais recente no topo: é onde o olho está, logo abaixo da busca.
      setLinhas((ls) => [{ product_id: id, quantidade: "1", novo }, ...ls]);
      setUltimo(`${nome} adicionado.`);
    }
  }

  function editar(id: string, quantidade: string) {
    setLinhas((ls) => ls.map((l) => (l.product_id === id ? { ...l, quantidade } : l)));
  }

  // Stepper: passo de 1, sem chegar a zero — tirar o produto é "Remover".
  function passo(l: Linha, delta: number) {
    const novo = (valido(l.quantidade) ? num(l.quantidade) : 0) + delta;
    if (novo > 0) editar(l.product_id, String(Math.round(novo * 1000) / 1000));
  }

  function remover(id: string) {
    setLinhas((ls) => ls.filter((l) => l.product_id !== id));
    setUltimo(null);
  }

  function cancelar() {
    if (linhas.length > 0 && !window.confirm("Descartar esta carga manual? Os produtos adicionados se perdem.")) return;
    onCancelar();
  }

  const carregarRefs = useCallback(async (): Promise<ProductRefs> => {
    const resp = await browserApi.request(`/orgs/${org}/products/refs${localId ? `?loja=${localId}` : ""}`, await token());
    const payload = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(payload.detail ?? `backend respondeu ${resp.status}`);
    return payload as ProductRefs;
  }, [org, localId]);

  const valorTotal = valorInformado(valor);
  const quantidadesRuins = linhas.filter((l) => !valido(l.quantidade)).length;
  const foraDaConta = linhas.filter((l) => !daLoja.has(l.product_id)).length;
  const totalUnidades = linhas.filter((l) => valido(l.quantidade)).reduce((s, l) => s + num(l.quantidade), 0);
  const podeLancar =
    !!localId && linhas.length > 0 && quantidadesRuins === 0 && foraDaConta === 0 && valorTotal.ok && !busy;

  const entram = useMemo(
    () => linhas.map((l) => ({ product_id: l.product_id, nome: porId.get(l.product_id)?.name ?? "Produto" })),
    [linhas, porId],
  );

  async function lancar() {
    if (!podeLancar) return;
    setBusy(true);
    setErro(null);
    try {
      const resp = await browserApi.request(`/orgs/${org}/picklist/manual`, await token(), {
        method: "POST",
        body: JSON.stringify({
          location_id: localId,
          fornecedor: fornecedor.trim() || null,
          valor_total: valorTotal.valor,
          itens: linhas.map((l) => ({ product_id: l.product_id, quantidade: String(num(l.quantidade)) })),
        }),
      });
      const payload = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(detalheDoErro(payload, resp.status));
      onLancada(totalUnidades);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "falha ao lançar a carga");
      setBusy(false);
    }
  }

  const pendencia = !localId
    ? "escolha a loja"
    : linhas.length === 0
      ? "adicione os produtos"
      : foraDaConta > 0
        ? `${foraDaConta} de outra conta VMpay`
        : quantidadesRuins > 0
          ? "confira as quantidades"
          : !valorTotal.ok
            ? "confira o valor pago"
            : null;

  return (
    <div className="flex min-w-0 flex-col gap-3.5 md:gap-4">
      {/* Celular: topo compacto + título grande, como na conferência do cupom. */}
      <div className="flex flex-col gap-2 md:hidden">
        <div>
          <button type="button" onClick={cancelar} className="inline-flex min-h-11 items-center text-[16px] text-azul-texto">
            <span aria-hidden="true">‹&nbsp;</span>Cupons
          </button>
        </div>
        <Titulo titulo="Carga manual" subtitulo="Sem cupom legível: adicione os produtos que vieram na compra." />
      </div>
      <div className="hidden md:block">
        <Titulo
          sobretitulo="Pick list"
          titulo="Carga manual"
          subtitulo="Sem cupom legível: adicione os produtos que vieram na compra e lance a carga."
          acoes={<Botao onClick={cancelar}>Cancelar</Botao>}
        />
      </div>

      <Cartao compacto>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_170px] md:gap-4">
          <label className="min-w-0 text-[13px] text-sec">
            Loja que recebeu
            <select
              value={localId}
              onChange={(e) => setLocalId(e.target.value)}
              className={`mt-1 ${CAMPO} ${localId ? "" : "border-[1.5px] border-laranja-borda bg-laranja-campo"}`}
            >
              <option value="">Escolha…</option>
              {opcoes.locais.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-0 text-[13px] text-sec">
            Fornecedor <span className="text-terc">(opcional)</span>
            <input
              value={fornecedor}
              onChange={(e) => setFornecedor(e.target.value)}
              maxLength={120}
              placeholder="Ex.: Atacadão"
              autoComplete="off"
              className={`mt-1 ${CAMPO}`}
            />
          </label>
          <label className="min-w-0 text-[13px] text-sec">
            Valor pago <span className="text-terc">(opcional)</span>
            <span className="relative mt-1 block">
              <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[15px] text-sec">
                R$
              </span>
              <input
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                inputMode="decimal"
                placeholder="0,00"
                aria-invalid={!valorTotal.ok}
                className={`${CAMPO} pl-10 tabular-nums ${valorTotal.ok ? "" : "border-[1.5px] border-laranja-borda bg-laranja-campo"}`}
              />
            </span>
          </label>
        </div>
        <p className="m-0 mt-2.5 text-[13px] text-sec">Os produtos oferecidos são só os da conta VMpay desta loja.</p>
      </Cartao>

      <Cartao compacto titulo="Adicionar produto" subtitulo="Busque pelo nome ou código de barras. Escolher de novo soma mais uma unidade.">
        {precisaLoja ? (
          <p className="m-0 text-[14px] text-sec">Escolha a loja que recebeu para buscar os produtos.</p>
        ) : (
          <ProductPicker
            produtos={produtosDaLoja}
            value=""
            sugestoes={[]}
            rotulo="Buscar produto para adicionar à carga"
            onChange={(id) => id && adicionar(id)}
            onCadastrar={() => setCadastrando(true)}
          />
        )}
        <p role="status" className="m-0 mt-2 min-h-[18px] text-[13px] text-sec">
          {ultimo ? (
            <>
              <span aria-hidden="true" className="text-verde-texto">
                ●{" "}
              </span>
              {ultimo}
            </>
          ) : null}
        </p>
      </Cartao>

      {linhas.length === 0 ? (
        <div className="rounded-[20px] border border-dashed border-tracejado px-4 py-6 text-center text-[14px] text-sec">
          Nenhum produto na carga ainda.
        </div>
      ) : (
        <section aria-label="Produtos da carga" className="vidro overflow-hidden rounded-[20px] md:rounded-[22px]">
          <ul className="m-0 list-none p-0 [&>li+li]:border-t [&>li+li]:border-sep">
            {linhas.map((l) => {
              const p = porId.get(l.product_id);
              const ruim = !valido(l.quantidade);
              return (
                <li
                  key={l.product_id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto_auto] md:px-[18px]"
                >
                  <div className="min-w-0">
                    <div className="break-words text-[15px] font-medium text-texto">{p?.name ?? "Produto"}</div>
                    {p?.barcode ? <div className="text-xs tabular-nums text-sec">{p.barcode}</div> : null}
                    {!daLoja.has(l.product_id) ? (
                      <p className="m-0 mt-1 text-[13px] text-vermelho-texto">
                        <span aria-hidden="true">■ </span>
                        É de outra conta VMpay — remova ou troque a loja.
                      </p>
                    ) : null}
                    {l.novo ? (
                      <p className="m-0 mt-1 text-[13px] text-laranja-texto">
                        <span aria-hidden="true">▲ </span>
                        Produto recém-cadastrado: inclua-o no planograma da máquina na VMpay antes de lançar — fora
                        do planograma a VMpay recusa a carga inteira.
                      </p>
                    ) : null}
                  </div>
                  <span
                    className={`col-start-1 row-start-2 inline-flex items-center justify-self-start rounded-[10px] bg-trilho md:col-start-2 md:row-start-1 ${
                      ruim ? "ring-[1.5px] ring-laranja-borda" : ""
                    }`}
                  >
                    <button
                      type="button"
                      aria-label={`Menos ${p?.name ?? ""}`}
                      onClick={() => passo(l, -1)}
                      className="h-11 w-11 text-[20px] text-azul-texto md:h-10 md:w-10"
                    >
                      −
                    </button>
                    <input
                      inputMode="decimal"
                      aria-label={`Quantidade de ${p?.name ?? "produto"}`}
                      value={l.quantidade}
                      onChange={(e) => editar(l.product_id, e.target.value)}
                      className="h-11 w-14 bg-transparent text-center text-base font-semibold tabular-nums text-texto md:h-10"
                    />
                    <button
                      type="button"
                      aria-label={`Mais ${p?.name ?? ""}`}
                      onClick={() => passo(l, 1)}
                      className="h-11 w-11 text-[20px] text-azul-texto md:h-10 md:w-10"
                    >
                      +
                    </button>
                  </span>
                  <button
                    type="button"
                    onClick={() => remover(l.product_id)}
                    aria-label={`Remover ${p?.name ?? "produto"}`}
                    className="col-start-2 row-start-1 inline-flex min-h-11 items-center justify-self-end rounded-full px-3 text-[14px] text-vermelho-texto hover:bg-vermelho-fundo md:col-start-3 md:min-h-10"
                  >
                    Remover
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {localId && linhas.length > 0 ? (
        <ConfrontoReposicao org={org} localId={localId} itens={entram} rotulo="carga" />
      ) : null}

      {erro ? (
        <div role="alert">
          <Aviso tom="vermelho">{erro}</Aviso>
        </div>
      ) : null}

      {/* Rodapé flutuante: no celular fica acima da barra de abas. */}
      <div className="vidro-forte sticky bottom-[calc(var(--abas-altura)+env(safe-area-inset-bottom)+4px)] z-20 mt-2 flex items-center justify-between gap-3 rounded-[20px] py-2.5 pl-4 pr-2.5 md:bottom-6 md:flex-wrap md:rounded-[22px] md:py-3.5 md:pl-[22px] md:pr-4">
        <p className="m-0 min-w-0 text-[13px] text-texto md:text-[15px]">
          <strong className="tabular-nums">{formatInt(totalUnidades)}</strong>
          <span className="md:hidden"> un. entram</span>
          <span className="hidden md:inline"> unidades entram na prateleira</span>
          {pendencia ? (
            <span className="block text-laranja-texto md:inline">
              <span className="hidden md:inline"> · </span>
              {pendencia}
            </span>
          ) : null}
        </p>
        <Botao variante="cheio" onClick={lancar} disabled={!podeLancar} className="shrink-0">
          {busy ? "Lançando…" : "Lançar carga"}
        </Botao>
      </div>

      {cadastrando ? (
        <NewProductModal
          aviso="O produto entra no cadastro da VMpay e já vai para esta carga. Para a carga ser aceita, inclua-o também no planograma da máquina."
          onClose={() => setCadastrando(false)}
          loadRefs={carregarRefs}
          onSubmit={async (body) => {
            const resp = await browserApi.request(`/orgs/${org}/products`, await token(), {
              method: "POST",
              body: JSON.stringify({ ...body, loja: localId || null }),
            });
            const payload = await resp.json().catch(() => ({}));
            if (!resp.ok) throw new Error(payload.detail ?? `backend respondeu ${resp.status}`);
            const id = payload.product_id as string;
            onProdutoCadastrado({ id, name: body.nome, barcode: body.barcode, conta: contaDaLoja ?? undefined });
            setLinhas((ls) => [{ product_id: id, quantidade: "1", novo: true }, ...ls]);
            setUltimo(`${body.nome} cadastrado e adicionado.`);
            setCadastrando(false);
          }}
        />
      ) : null}
    </div>
  );
}
