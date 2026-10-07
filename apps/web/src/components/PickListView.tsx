"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import type {
  PicklistCarga,
  PicklistConsulta,
  PicklistItem,
  PicklistOpcoes,
  ProductRefs,
} from "@/lib/api";
import { browserApi } from "@/lib/api";
import { CargaManual } from "@/components/CargaManual";
import { Aviso, CAMPO, ConfrontoReposicao, detalheDoErro, num, token, valido } from "@/components/picklist-comum";
import { NewProductModal } from "@/components/NewProductModal";
import { Paginacao, usePaginacao } from "@/components/Paginacao";
import { ProductPicker } from "@/components/ProductPicker";
import { Botao } from "@/components/ui/Botao";
import { Cartao } from "@/components/ui/Cartao";
import { Folha, RodapeFolha } from "@/components/ui/Folha";
import { CabecalhoLista, LinhaLista, Lista } from "@/components/ui/Lista";
import { Selo } from "@/components/ui/Selo";
import type { TomSelo } from "@/components/ui/Selo";
import { Titulo } from "@/components/ui/Titulo";
import { formatDayTime, formatInt, formatMoney } from "@/lib/format";

/** Campos numéricos ficam como texto enquanto o operador digita ("3," é válido no meio). */
type Linha = Omit<PicklistItem, "quantidade" | "fator" | "product_id"> & {
  quantidade: string;
  fator: string;
  product_id: string;
  // Cadastrado agora, pelo pick list: ainda fora do planograma da instalação.
  novo?: boolean;
};

function paraLinha(i: PicklistItem): Linha {
  return {
    ...i,
    quantidade: String(i.quantidade),
    fator: String(i.fator),
    product_id: i.product_id ?? "",
  };
}

function linhaVazia(linha: number): Linha {
  return {
    linha,
    codigo: null,
    descricao: "",
    quantidade: "1",
    unidade: "UN",
    valor_unitario: null,
    valor_total: null,
    product_id: "",
    fator: "1",
    ignorar: false,
    vinculo: null,
    sugestoes: [],
  };
}

const nadaMuda = () => () => {};

const STATUS: Record<PicklistCarga["status"], { rotulo: string; tom: TomSelo }> = {
  approved: { rotulo: "carregado", tom: "verde" },
  error: { rotulo: "recusado pela VMpay", tom: "vermelho" },
  pending: { rotulo: "em andamento", tom: "laranja" },
};

const POR_PAGINA = 20;

const CAMPO_NUM =
  "mt-[3px] block h-11 w-full rounded-[10px] border border-campo-borda bg-campo px-2.5 text-base tabular-nums text-texto disabled:opacity-60 md:h-10 md:text-[15px]";
const DICA_FATOR =
  "Quantas unidades de prateleira vêm em cada unidade do cupom (1 fardo = 6, 1 display = 24)";

/** "cód. 552 · 6 UN × R$ 11,99 · preço de compra" — só para conferir com o papel. */
function linhaDeCompra(l: Linha, comCodigo: boolean): string {
  const partes: string[] = [];
  if (comCodigo && l.codigo) partes.push(`cód. ${l.codigo}`);
  if (l.valor_unitario !== null) {
    const q = valido(l.quantidade) ? String(num(l.quantidade)).replace(".", ",") : "?";
    partes.push(`${q} ${l.unidade ?? ""} × ${formatMoney(l.valor_unitario)}`.replace("  ", " "));
    partes.push("preço de compra");
  }
  return partes.join(" · ");
}

export function PickListView({
  org,
  opcoes,
  historico,
}: {
  org: string;
  opcoes: PicklistOpcoes;
  historico: PicklistCarga[];
}) {
  const router = useRouter();
  const [entrada, setEntrada] = useState("");
  const [consulta, setConsulta] = useState<PicklistConsulta | null>(null);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [localId, setLocalId] = useState(opcoes.locais.length === 1 ? opcoes.locais[0].id : "");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [lendoQR, setLendoQR] = useState(false);
  const [produtos, setProdutos] = useState(opcoes.produtos);
  const [cadastrando, setCadastrando] = useState<number | null>(null);
  // Carga manual: compra sem cupom legível, montada com produtos do sistema.
  const [montando, setMontando] = useState(false);
  // Qualquer navegador com câmera: o leitor nativo (Chrome/Android) ou o jsQR
  // (Safari/iPhone, que não tem BarcodeDetector). No servidor: false.
  const temCamera = useSyncExternalStore(
    nadaMuda,
    () => !!navigator.mediaDevices?.getUserMedia,
    () => false,
  );

  // Várias contas VMpay: só os produtos da conta da loja escolhida — produto
  // de outra conta a VMpay recusaria na carga.
  const contaDaLoja = opcoes.locais.find((l) => l.id === localId)?.conta ?? null;
  const produtosDaLoja = useMemo(
    () => (contaDaLoja ? produtos.filter((p) => !p.conta || p.conta === contaDaLoja) : produtos),
    [produtos, contaDaLoja],
  );
  // A dica "Parece ser…" só cita produto que a loja escolhida pode receber.
  const nomeProduto = useMemo(
    () => new Map(produtosDaLoja.map((p) => [p.id, p.name])),
    [produtosDaLoja],
  );

  const carregarRefs = useCallback(async (): Promise<ProductRefs> => {
    const resp = await browserApi.request(
      `/orgs/${org}/products/refs${localId ? `?loja=${localId}` : ""}`,
      await token(),
    );
    const payload = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(payload.detail ?? `backend respondeu ${resp.status}`);
    return payload as ProductRefs;
  }, [org, localId]);

  const buscar = useCallback(
    async (texto: string) => {
      setBusy(true);
      setErro(null);
      setFeedback(null);
      try {
        const resp = await browserApi.request(`/orgs/${org}/picklist/consulta`, await token(), {
          method: "POST",
          body: JSON.stringify({ entrada: texto }),
        });
        const payload = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(payload.detail ?? `backend respondeu ${resp.status}`);
        const c = payload as PicklistConsulta;
        setConsulta(c);
        setLinhas(c.cupom ? c.cupom.itens.map(paraLinha) : [linhaVazia(1)]);
      } catch (err) {
        setErro(err instanceof Error ? err.message : "falha na consulta");
      } finally {
        setBusy(false);
      }
    },
    [org],
  );

  const aoLerQR = useCallback(
    (texto: string) => {
      setLendoQR(false);
      setEntrada(texto);
      void buscar(texto);
    },
    [buscar],
  );

  function editar(idx: number, campos: Partial<Linha>) {
    setLinhas((ls) => ls.map((l, i) => (i === idx ? { ...l, ...campos } : l)));
  }

  // Stepper do celular: passo de 1, sem deixar a quantidade chegar a zero —
  // tirar o item é "Ignorar", não quantidade 0.
  function passo(idx: number, delta: number) {
    const atual = valido(linhas[idx].quantidade) ? num(linhas[idx].quantidade) : 0;
    const novo = atual + delta;
    if (novo > 0) editar(idx, { quantidade: String(Math.round(novo * 1000) / 1000) });
  }

  function recomecar() {
    setConsulta(null);
    setLinhas([]);
    setEntrada("");
    setErro(null);
  }

  // Cupom × Reposição: cada produto que entra, uma vez só (o mesmo produto
  // pode vir em duas linhas do cupom).
  const entram = useMemo(() => {
    const vistos = new Map<string, { product_id: string; nome: string }>();
    for (const l of linhas) {
      if (!l.ignorar && l.product_id && !vistos.has(l.product_id)) {
        vistos.set(l.product_id, { product_id: l.product_id, nome: nomeProduto.get(l.product_id) ?? l.descricao });
      }
    }
    return [...vistos.values()];
  }, [linhas, nomeProduto]);

  // Cupom grande (atacado) passa de 50 linhas: a conferência pagina, mas a
  // edição e a aprovação valem para TODAS as linhas — só a vista é fatiada.
  const pagLinhas = usePaginacao(linhas, POR_PAGINA);
  const pagHistorico = usePaginacao(historico, 10);

  const pendencias = useMemo(
    () =>
      linhas.filter(
        (l) =>
          !l.ignorar &&
          (!l.product_id || !valido(l.quantidade) || !valido(l.fator) || !l.descricao.trim()),
      ).length,
    [linhas],
  );
  const semProduto = linhas.filter((l) => !l.ignorar && !l.product_id).length;
  const totalUnidades = useMemo(
    () =>
      linhas
        .filter((l) => !l.ignorar && valido(l.quantidade) && valido(l.fator))
        .reduce((s, l) => s + num(l.quantidade) * num(l.fator), 0),
    [linhas],
  );
  const podeAprovar =
    !!consulta && !consulta.ja_carregado && !!localId && pendencias === 0 &&
    linhas.some((l) => !l.ignorar) && !busy;

  async function aprovar() {
    if (!consulta || !podeAprovar) return;
    setBusy(true);
    setErro(null);
    try {
      const resp = await browserApi.request(`/orgs/${org}/picklist/aprovar`, await token(), {
        method: "POST",
        body: JSON.stringify({
          chave: consulta.chave,
          origem: consulta.origem,
          location_id: localId,
          numero: consulta.cupom?.numero ?? null,
          serie: consulta.cupom?.serie ?? null,
          emitido_em: consulta.cupom?.emitido_em ?? null,
          fornecedor_nome: consulta.cupom?.fornecedor_nome ?? null,
          valor_total: consulta.cupom?.valor_total ?? null,
          itens: linhas.map((l) => ({
            linha: l.linha,
            codigo: l.codigo,
            descricao: l.descricao.trim(),
            quantidade: String(num(l.quantidade)),
            unidade: l.unidade,
            valor_unitario: l.valor_unitario,
            valor_total: l.valor_total,
            product_id: l.ignorar ? null : l.product_id || null,
            fator: String(num(l.fator)),
            ignorar: l.ignorar,
          })),
        }),
      });
      const payload = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(detalheDoErro(payload, resp.status));
      recomecar();
      setFeedback(`Cupom carregado: ${totalUnidades} unidades entraram na prateleira.`);
      router.refresh();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "falha na aprovação");
    } finally {
      setBusy(false);
    }
  }

  const manual = consulta?.origem === "manual";
  const fornecedor = consulta
    ? consulta.cupom?.fornecedor_nome || `Fornecedor ${consulta.fornecedor_cnpj}`
    : "";
  const resumoCupom = consulta?.cupom
    ? [
        `NFC-e ${consulta.cupom.numero}`,
        consulta.cupom.emitido_em ? formatDayTime(consulta.cupom.emitido_em) : null,
        formatMoney(consulta.cupom.valor_total),
        `${consulta.cupom.itens.length} itens`,
      ]
        .filter(Boolean)
        .join(" · ")
    : consulta
      ? `Chave ${consulta.chave}`
      : "";
  const nomeLoja = opcoes.locais.find((l) => l.id === localId)?.name;

  /** Produto no sistema + as dicas embaixo dele — igual no computador e no celular. */
  function blocoProduto(l: Linha, idx: number) {
    if (l.ignorar) {
      return <p className="m-0 flex min-h-10 items-center text-[13px] text-sec">Ignorado — não entra na prateleira.</p>;
    }
    const falta = !l.product_id;
    return (
      <>
        <ProductPicker
          produtos={produtosDaLoja}
          value={l.product_id}
          sugestoes={l.sugestoes}
          destacado={falta}
          lembrado={l.vinculo === "lembrado"}
          rotulo={`Produto no sistema para ${l.descricao || `a linha ${l.linha}`}`}
          onChange={(id) => editar(idx, { product_id: id, vinculo: null, novo: false })}
          onCadastrar={() => setCadastrando(idx)}
        />
        {falta && l.sugestoes[0] && nomeProduto.has(l.sugestoes[0]) ? (
          <p className="m-0 mt-1.5 text-[13px] text-sec">
            Parece ser <strong className="font-semibold text-texto">{nomeProduto.get(l.sugestoes[0])}</strong>{" "}
            <button
              type="button"
              onClick={() => editar(idx, { product_id: l.sugestoes[0] })}
              className="inline-flex min-h-11 items-center px-0.5 font-medium text-azul-texto md:min-h-0"
            >
              usar
            </button>
          </p>
        ) : null}
        {l.novo ? (
          <p className="m-0 mt-1.5 text-[13px] text-laranja-texto">
            <span aria-hidden="true">▲ </span>
            Produto recém-cadastrado: inclua-o no planograma da máquina na VMpay antes de aprovar — fora
            do planograma a VMpay recusa a carga do cupom inteiro.
          </p>
        ) : null}
        {l.product_id && valido(l.quantidade) && valido(l.fator) && num(l.fator) !== 1 ? (
          <p className="m-0 mt-1.5 text-[13px] tabular-nums text-sec">
            Entram {num(l.quantidade) * num(l.fator)} unidades
          </p>
        ) : null}
      </>
    );
  }

  function campoDescricao(l: Linha, idx: number) {
    return (
      <input
        value={l.descricao}
        onChange={(e) => editar(idx, { descricao: e.target.value })}
        placeholder="Descrição no cupom"
        aria-label={`Descrição da linha ${l.linha}`}
        disabled={l.ignorar}
        className={CAMPO}
      />
    );
  }

  function abrirCargaManual() {
    recomecar();
    setFeedback(null);
    setMontando(true);
  }

  if (montando) {
    return (
      <CargaManual
        org={org}
        opcoes={{ ...opcoes, produtos }}
        localInicial={localId}
        onProdutoCadastrado={(p) => setProdutos((ps) => [...ps, p])}
        onCancelar={() => setMontando(false)}
        onLancada={(unidades) => {
          setMontando(false);
          setFeedback(`Carga manual lançada: ${formatInt(unidades)} unidades entraram na prateleira.`);
          router.refresh();
        }}
      />
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-3.5 md:gap-4">
      {!consulta ? (
        <Titulo
          titulo="Pick list"
          subtitulo="Reposição da prateleira pelo cupom fiscal da compra: leia o QR Code, confira e aprove."
        />
      ) : (
        <>
          {/* Celular: topo compacto + título grande; o fornecedor desce para a linha de resumo. */}
          <div className="flex flex-col gap-2 md:hidden">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={recomecar}
                className="inline-flex min-h-11 items-center text-[16px] text-azul-texto"
              >
                <span aria-hidden="true">‹&nbsp;</span>Cupons
              </button>
              {temCamera ? (
                <Botao
                  tamanho="p"
                  onClick={() => {
                    recomecar();
                    setLendoQR(true);
                  }}
                >
                  Ler QR Code
                </Botao>
              ) : null}
            </div>
            <Titulo
              titulo="Conferir cupom"
              subtitulo={
                <>
                  <strong className="font-semibold text-texto">{fornecedor}</strong> · {resumoCupom}
                  {nomeLoja ? (
                    <>
                      {" "}
                      · loja <strong className="font-semibold text-texto">{nomeLoja}</strong>
                    </>
                  ) : null}
                </>
              }
            />
          </div>
          <div className="hidden md:block">
            <Titulo
              sobretitulo={resumoCupom}
              titulo={fornecedor}
              subtitulo="Confira cada item e ligue a um produto do sistema."
              acoes={<Botao onClick={recomecar}>Outro cupom</Botao>}
            />
          </div>
        </>
      )}

      {feedback ? (
        <div role="status">
          <Aviso tom="verde">
            {feedback}{" "}
            <button
              type="button"
              className="ml-1 inline-flex min-h-11 items-center text-[13px] text-azul-texto md:min-h-0"
              onClick={() => setFeedback(null)}
            >
              fechar
            </button>
          </Aviso>
        </div>
      ) : null}

      {!consulta ? (
        <>
          <Cartao>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (entrada.trim()) void buscar(entrada);
              }}
            >
              <label className="block text-[13px] text-sec">
                Link do QR Code ou chave de acesso
                <input
                  autoFocus
                  value={entrada}
                  onChange={(e) => setEntrada(e.target.value)}
                  placeholder="https://www.nfce.fazenda.sp.gov.br/…?p=3526… ou os 44 dígitos"
                  className={`mt-1 ${CAMPO}`}
                />
              </label>
              <div className="mt-3 flex flex-col gap-2.5 md:flex-row md:flex-wrap">
                <Botao type="submit" variante="cheio" disabled={busy || !entrada.trim()}>
                  {busy ? "Consultando a SEFAZ…" : "Buscar cupom"}
                </Botao>
                {temCamera ? <Botao onClick={() => setLendoQR(true)}>Ler QR Code</Botao> : null}
                <Botao onClick={abrirCargaManual}>
                  Criar carga manual
                </Botao>
              </div>
              <p className="m-0 mt-3 text-[13px] text-sec">
                Pelo QR Code os itens vêm sozinhos. Só com a chave, a SEFAZ pede CAPTCHA — os itens são
                lançados à mão. Sem cupom legível, crie uma carga manual com os produtos que vieram.
              </p>
            </form>
          </Cartao>
          {erro ? (
            <div role="alert" className="flex flex-col gap-2">
              <Aviso tom="vermelho">{erro}</Aviso>
              {/* QR recusado pela SEFAZ (ex.: cupom de contingência): a chave
                  continua valendo — um toque leva ao lançamento manual. */}
              {erro.includes("pela chave") && chaveDoQR(entrada) ? (
                <div className="flex flex-col gap-2.5 md:flex-row md:flex-wrap">
                  <Botao
                    variante="tingido"
                    disabled={busy}
                    onClick={() => {
                      const chave = chaveDoQR(entrada)!;
                      setEntrada(chave);
                      void buscar(chave);
                    }}
                  >
                    Lançar à mão pela chave
                  </Botao>
                  {/* Nem a chave serve quando não há nota para abrir na SEFAZ. */}
                  <Botao variante="tingido" disabled={busy} onClick={abrirCargaManual}>
                    Criar carga manual
                  </Botao>
                </div>
              ) : null}
            </div>
          ) : null}

          {historico.length > 0 ? (
            <section className="flex flex-col gap-2">
              <CabecalhoLista>Cupons e cargas carregados</CabecalhoLista>
              <Lista>
                {pagHistorico.visiveis.map((h) => (
                  <LinhaLista
                    key={h.id}
                    href={`/picklist/cupom/${h.id}`}
                    principal={
                      h.source === "avulsa" ? (
                        <>
                          Carga manual · {h.supplier_name || "sem fornecedor"}
                          <Selo tom="cinza" simbolo={null} className="ml-2 align-[1px]">
                            manual
                          </Selo>
                        </>
                      ) : (
                        <>
                          {h.supplier_name || "Fornecedor"}
                          {h.number ? ` · NFC-e ${h.number}` : ""}
                        </>
                      )
                    }
                    secundario={
                      <>
                        {formatDayTime(h.created_at)} · {h.location_name} · {h.itens} itens
                        {h.total !== null ? ` · ${formatMoney(h.total)}` : ""}
                      </>
                    }
                    direita={<Selo tom={STATUS[h.status].tom}>{STATUS[h.status].rotulo}</Selo>}
                  />
                ))}
              </Lista>
              <Paginacao {...pagHistorico.rodape} rotulo="cupons" />
            </section>
          ) : null}
        </>
      ) : (
        <>
          {consulta.ja_carregado ? (
            <div role="alert">
              <Aviso tom="laranja">
                Este cupom já foi carregado em {formatDayTime(consulta.ja_carregado.em)} — aprovar de novo
                dobraria o saldo.
              </Aviso>
            </div>
          ) : null}

          {manual ? (
            <Aviso tom="cinza">
              <span className="text-sec">
                Sem o QR Code a consulta da SEFAZ pede CAPTCHA.{" "}
                <a href={consulta.consulta_url} target="_blank" rel="noreferrer" className="text-azul-texto">
                  Abra a nota na SEFAZ
                </a>{" "}
                e lance os itens abaixo.
              </span>
            </Aviso>
          ) : null}

          <Cartao compacto>
            <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
              <label className="min-w-0 flex-[0_1_380px] text-[13px] text-sec">
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
              <p className="m-0 text-[14px] text-sec md:pb-3">
                Os produtos oferecidos são só os da conta VMpay desta loja.
              </p>
            </div>
          </Cartao>

          {/* Computador: uma superfície de vidro, uma linha por item do cupom. */}
          <section aria-label="Itens do cupom" className="vidro hidden overflow-hidden rounded-[22px] md:block">
            <ul className="m-0 list-none p-0 [&>li+li]:border-t [&>li+li]:border-sep">
              {pagLinhas.visiveis.map((l, k) => {
                const idx = pagLinhas.pagina * POR_PAGINA + k;
                const compra = linhaDeCompra(l, true);
                return (
                  <li
                    key={l.linha}
                    className={`grid grid-cols-[minmax(0,1.2fr)_90px_90px_minmax(0,1.4fr)_90px] items-start gap-3.5 px-[18px] py-3.5 ${
                      l.ignorar ? "opacity-45" : ""
                    }`}
                  >
                    <div className="min-w-0">
                      {manual ? (
                        campoDescricao(l, idx)
                      ) : (
                        <div className="break-words text-[15px] font-medium text-texto">{l.descricao}</div>
                      )}
                      {compra ? <div className="mt-0.5 text-xs tabular-nums text-sec">{compra}</div> : null}
                    </div>
                    <label className="text-[11px] text-sec">
                      Qtde.
                      <input
                        inputMode="decimal"
                        value={l.quantidade}
                        disabled={l.ignorar}
                        onChange={(e) => editar(idx, { quantidade: e.target.value })}
                        className={CAMPO_NUM}
                      />
                    </label>
                    <label className="text-[11px] text-sec" title={DICA_FATOR}>
                      Un./emb.
                      <input
                        inputMode="decimal"
                        value={l.fator}
                        disabled={l.ignorar}
                        onChange={(e) => editar(idx, { fator: e.target.value })}
                        className={CAMPO_NUM}
                      />
                    </label>
                    <div className="min-w-0">
                      <div className="mb-[3px] text-[11px] text-sec">Produto no sistema</div>
                      {blocoProduto(l, idx)}
                    </div>
                    <label className="flex items-center gap-1.5 pt-[22px] text-[13px] text-sec">
                      <input
                        type="checkbox"
                        checked={l.ignorar}
                        onChange={(e) => editar(idx, { ignorar: e.target.checked })}
                      />
                      Ignorar
                    </label>
                  </li>
                );
              })}
            </ul>
            {pagLinhas.totalPaginas > 1 ? (
              <div className="px-[18px] pb-3.5">
                <Paginacao {...pagLinhas.rodape} rotulo="linhas do cupom" />
              </div>
            ) : null}
          </section>

          {/* Celular: cada item vira um cartão, com stepper na quantidade. */}
          <ul aria-label="Itens do cupom" className="m-0 flex list-none flex-col gap-3 p-0 md:hidden">
            {pagLinhas.visiveis.map((l, k) => {
              const idx = pagLinhas.pagina * POR_PAGINA + k;
              const compra = linhaDeCompra(l, false);
              return (
                <li key={l.linha} className={`vidro rounded-[18px] p-3.5 ${l.ignorar ? "opacity-45" : ""}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      {manual ? (
                        campoDescricao(l, idx)
                      ) : (
                        <span className="block break-words text-[15px] font-semibold text-texto">{l.descricao}</span>
                      )}
                    </div>
                    <label className="-mt-2.5 flex min-h-11 shrink-0 items-center gap-1 text-xs text-sec">
                      <input
                        type="checkbox"
                        checked={l.ignorar}
                        onChange={(e) => editar(idx, { ignorar: e.target.checked })}
                      />
                      Ignorar
                    </label>
                  </div>
                  <div className="mb-2.5 mt-0.5 text-xs tabular-nums text-sec">
                    {[l.codigo ? `cód. ${l.codigo}` : null, compra || null].filter(Boolean).join(" · ")}
                  </div>
                  {blocoProduto(l, idx)}
                  {!l.ignorar ? (
                    <div className="mt-2.5 flex flex-wrap items-center gap-2.5 text-[13px] text-sec">
                      Qtde.
                      <span className="inline-flex items-center rounded-[10px] bg-trilho">
                        <button
                          type="button"
                          aria-label="Menos"
                          onClick={() => passo(idx, -1)}
                          className="h-11 w-11 text-[20px] text-azul-texto"
                        >
                          −
                        </button>
                        <input
                          inputMode="decimal"
                          aria-label="Quantidade"
                          value={l.quantidade}
                          onChange={(e) => editar(idx, { quantidade: e.target.value })}
                          className="h-11 w-12 bg-transparent text-center text-base font-semibold tabular-nums text-texto"
                        />
                        <button
                          type="button"
                          aria-label="Mais"
                          onClick={() => passo(idx, 1)}
                          className="h-11 w-11 text-[20px] text-azul-texto"
                        >
                          +
                        </button>
                      </span>
                      ×
                      <label className="flex items-center gap-1.5" title={DICA_FATOR}>
                        <input
                          inputMode="decimal"
                          value={l.fator}
                          onChange={(e) => editar(idx, { fator: e.target.value })}
                          className="h-11 w-14 rounded-[10px] border border-campo-borda bg-campo px-2 text-center text-base font-semibold tabular-nums text-texto"
                        />
                        un./emb.
                      </label>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {pagLinhas.totalPaginas > 1 ? (
            <div className="md:hidden">
              <Paginacao {...pagLinhas.rodape} rotulo="linhas do cupom" />
            </div>
          ) : null}

          {manual ? (
            <div>
              <Botao
                onClick={() => setLinhas((ls) => [...ls, linhaVazia(Math.max(0, ...ls.map((x) => x.linha)) + 1)])}
              >
                Adicionar item
              </Botao>
            </div>
          ) : null}

          {localId ? <ConfrontoReposicao org={org} localId={localId} itens={entram} rotulo="cupom" /> : null}

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
              {semProduto > 0 ? (
                <span className="block text-laranja-texto md:inline">
                  <span className="hidden md:inline"> · </span>
                  {semProduto} {semProduto === 1 ? "item" : "itens"} sem produto
                </span>
              ) : pendencias > 0 ? (
                <span className="block text-laranja-texto md:inline">
                  <span className="hidden md:inline"> · </span>
                  confira as quantidades
                </span>
              ) : null}
              {!localId ? (
                <span className="block text-laranja-texto md:inline">
                  <span className="hidden md:inline"> · </span>
                  escolha a loja
                </span>
              ) : null}
            </p>
            <Botao variante="cheio" onClick={aprovar} disabled={!podeAprovar} className="shrink-0">
              {busy ? "Carregando…" : "Aprovar e carregar"}
            </Botao>
          </div>
        </>
      )}

      {cadastrando !== null && linhas[cadastrando] ? (
        <NewProductModal
          initialNome={linhas[cadastrando].descricao}
          aviso="O produto entra no cadastro da VMpay e já fica ligado a este item do cupom. Para a carga ser aceita, inclua-o também no planograma da máquina."
          onClose={() => setCadastrando(null)}
          loadRefs={carregarRefs}
          onSubmit={async (body) => {
            const resp = await browserApi.request(`/orgs/${org}/products`, await token(), {
              method: "POST",
              body: JSON.stringify({ ...body, loja: localId || null }),
            });
            const payload = await resp.json().catch(() => ({}));
            if (!resp.ok) throw new Error(payload.detail ?? `backend respondeu ${resp.status}`);
            const id = payload.product_id as string;
            setProdutos((ps) => [...ps, { id, name: body.nome, barcode: body.barcode, conta: contaDaLoja ?? undefined }]);
            editar(cadastrando, { product_id: id, vinculo: null, novo: true });
            setCadastrando(null);
          }}
        />
      ) : null}

      {lendoQR ? <LeitorQR onLido={aoLerQR} onClose={() => setLendoQR(false)} /> : null}
    </div>
  );
}

type Detector = { detect: (src: HTMLVideoElement) => Promise<{ rawValue: string }[]> };

/**
 * Lê um quadro do vídeo e devolve o texto do QR (ou null). Usa o leitor nativo
 * do navegador quando existe; senão o jsQR — carregado só aqui, para não pesar
 * a página de quem nunca abre a câmera.
 */
async function leitorDeQr(): Promise<(video: HTMLVideoElement) => Promise<string | null>> {
  if ("BarcodeDetector" in window) {
    const Ctor = (window as unknown as { BarcodeDetector: new (o: object) => Detector }).BarcodeDetector;
    const detector = new Ctor({ formats: ["qr_code"] });
    return async (video) => (await detector.detect(video))[0]?.rawValue ?? null;
  }
  const { default: jsQR } = await import("jsqr");
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  return async (video) => {
    if (!ctx || !video.videoWidth) return null;
    // Quadro reduzido: o QR do cupom é grande no enquadramento, e 640px de
    // largura leem bem sem travar celular mais simples.
    const escala = Math.min(1, 640 / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * escala);
    canvas.height = Math.round(video.videoHeight * escala);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(img.data, img.width, img.height)?.data ?? null;
  };
}

function LeitorQR({ onLido, onClose }: { onLido: (texto: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        const video = videoRef.current;
        if (!video || !ativo) return;
        video.srcObject = stream;
        await video.play();
        const decodificar = await leitorDeQr();
        // 4 leituras por segundo bastam e poupam bateria frente a um quadro por frame.
        const ler = async () => {
          if (!ativo) return;
          try {
            const texto = await decodificar(video);
            if (texto) {
              onLido(texto);
              return;
            }
          } catch {
            /* quadro ilegível: tenta o próximo */
          }
          timer = setTimeout(ler, 250);
        };
        void ler();
      } catch {
        setErro("Não foi possível abrir a câmera. Libere a permissão ou cole o link do QR Code.");
      }
    })();

    return () => {
      ativo = false;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onLido]);

  return (
    <Folha titulo="Aponte para o QR Code do cupom" onFechar={onClose} largura="md:max-w-md">
      {erro ? (
        <p role="alert" className="m-0 text-[14px] text-vermelho-texto">
          ■ {erro}
        </p>
      ) : (
        <video ref={videoRef} muted playsInline className="aspect-square w-full rounded-2xl bg-black object-cover" />
      )}
      <RodapeFolha>
        <Botao onClick={onClose}>Cancelar</Botao>
      </RodapeFolha>
    </Folha>
  );
}

/** A chave de 44 dígitos no começo do `p` do QR (o link ou o próprio conteúdo). */
function chaveDoQR(texto: string): string | null {
  let t = texto;
  try {
    t = decodeURIComponent(texto);
  } catch {
    // "%" solto no texto colado: procura no texto como veio.
  }
  const m = t.match(/(?:p=)?(\d{44})\|/);
  return m ? m[1] : null;
}
