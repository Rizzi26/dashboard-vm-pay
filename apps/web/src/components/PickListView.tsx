"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import type { PicklistCarga, PicklistConsulta, PicklistItem, PicklistOpcoes, ProductRefs } from "@/lib/api";
import { browserApi } from "@/lib/api";
import { NewProductModal } from "@/components/NewProductModal";
import { ProductPicker } from "@/components/ProductPicker";
import { formatDayTime, formatMoney } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase/browser";

async function token(): Promise<string> {
  const { data } = await supabaseBrowser().auth.getSession();
  if (!data.session) throw new Error("sessão expirada — entre de novo");
  return data.session.access_token;
}

/** Campos numéricos ficam como texto enquanto o operador digita ("3," é válido no meio). */
type Linha = Omit<PicklistItem, "quantidade" | "fator" | "product_id"> & {
  quantidade: string;
  fator: string;
  product_id: string;
  // Cadastrado agora, pelo pick list: ainda fora do planograma da instalação.
  novo?: boolean;
};

const num = (s: string) => Number(s.replace(",", "."));
const valido = (s: string) => Number.isFinite(num(s)) && num(s) > 0;

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

const STATUS_LABEL: Record<PicklistCarga["status"], string> = {
  approved: "carregado",
  error: "recusado pela VMpay",
  pending: "em andamento",
};

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
  // BarcodeDetector existe no Chrome/Android; no iPhone a câmera nativa lê o
  // QR e abre o link — o operador copia e cola no campo. No servidor: false.
  const temCamera = useSyncExternalStore(
    nadaMuda,
    () => "BarcodeDetector" in window,
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

  function recomecar() {
    setConsulta(null);
    setLinhas([]);
    setEntrada("");
    setErro(null);
  }

  const pendencias = useMemo(
    () =>
      linhas.filter(
        (l) =>
          !l.ignorar &&
          (!l.product_id || !valido(l.quantidade) || !valido(l.fator) || !l.descricao.trim()),
      ).length,
    [linhas],
  );
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
      if (!resp.ok) {
        const detalhe = Array.isArray(payload.detail)
          ? payload.detail.map((d: { msg: string }) => d.msg).join("; ")
          : payload.detail;
        throw new Error(detalhe ?? `backend respondeu ${resp.status}`);
      }
      recomecar();
      setFeedback(`Cupom carregado: ${totalUnidades} unidades entraram no estoque.`);
      router.refresh();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "falha na aprovação");
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "w-full rounded-md border border-[var(--grid)] bg-transparent px-2 py-1.5 text-base text-[var(--text-primary)] focus:border-[var(--accent)] sm:text-sm";
  const botaoPrimario =
    "rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-[var(--accent-contrast)] disabled:opacity-50";
  const botaoSecundario =
    "rounded-md border border-[var(--grid)] px-4 py-2.5 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]";

  return (
    <div className="space-y-6">
      {feedback ? (
        <p role="status" className="rounded-md border border-[var(--grid)] px-3 py-2 text-sm text-[var(--text-primary)]">
          {feedback}
          <button type="button" className="ml-3 text-xs text-[var(--text-secondary)] underline" onClick={() => setFeedback(null)}>
            fechar
          </button>
        </p>
      ) : null}

      {!consulta ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (entrada.trim()) void buscar(entrada);
          }}
          className="rounded-xl border border-[var(--grid)] bg-[var(--surface-1)] p-4 sm:p-5"
        >
          <label className="block text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">
            Link do QR Code ou chave de acesso
            <input
              autoFocus
              value={entrada}
              onChange={(e) => setEntrada(e.target.value)}
              placeholder="https://www.nfce.fazenda.sp.gov.br/…?p=3526… ou os 44 dígitos"
              className={`mt-1 ${inputCls}`}
            />
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="submit" disabled={busy || !entrada.trim()} className={botaoPrimario}>
              {busy ? "Consultando a SEFAZ…" : "Buscar cupom"}
            </button>
            {temCamera ? (
              <button type="button" onClick={() => setLendoQR(true)} className={botaoSecundario}>
                Ler QR Code
              </button>
            ) : null}
          </div>
          <p className="mt-3 text-xs text-[var(--text-secondary)]">
            Pelo QR Code os itens vêm sozinhos. Só com a chave, a SEFAZ pede CAPTCHA — os itens
            são lançados à mão.
          </p>
        </form>
      ) : (
        <section className="rounded-xl border border-[var(--grid)] bg-[var(--surface-1)] p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-[var(--text-primary)]">
                {consulta.cupom?.fornecedor_nome || `Fornecedor ${consulta.fornecedor_cnpj}`}
              </h2>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">
                {consulta.cupom ? (
                  <>
                    NFC-e {consulta.cupom.numero}
                    {consulta.cupom.emitido_em ? ` · ${formatDayTime(consulta.cupom.emitido_em)}` : ""}
                    {" · "}
                    {formatMoney(consulta.cupom.valor_total)} · {consulta.cupom.itens.length} itens
                  </>
                ) : (
                  <>Chave {consulta.chave}</>
                )}
              </p>
            </div>
            <button type="button" onClick={recomecar} className={botaoSecundario}>
              Outro cupom
            </button>
          </div>

          {consulta.ja_carregado ? (
            <p role="alert" className="mt-4 rounded-md border border-[var(--status-warning)] px-3 py-2 text-sm text-[var(--text-primary)]">
              Este cupom já foi carregado em {formatDayTime(consulta.ja_carregado.em)} — aprovar de
              novo dobraria o estoque.
            </p>
          ) : null}

          {consulta.origem === "manual" ? (
            <p className="mt-4 rounded-md border border-[var(--grid)] px-3 py-2 text-sm text-[var(--text-secondary)]">
              Sem o QR Code a consulta da SEFAZ pede CAPTCHA.{" "}
              <a href={consulta.consulta_url} target="_blank" rel="noreferrer" className="underline">
                Abra a nota na SEFAZ
              </a>{" "}
              e lance os itens abaixo.
            </p>
          ) : null}

          <label className="mt-4 block max-w-sm text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">
            Local que recebeu
            <select value={localId} onChange={(e) => setLocalId(e.target.value)} className={`mt-1 ${inputCls}`}>
              <option value="">Escolha…</option>
              {opcoes.locais.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>

          <ul className="mt-4 divide-y divide-[var(--grid)]">
            {linhas.map((l, idx) => {
              const manual = consulta.origem === "manual";
              const falta = !l.ignorar && !l.product_id;
              return (
                <li key={l.linha} className={`py-3 ${l.ignorar ? "opacity-50" : ""}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      {manual ? (
                        <input
                          value={l.descricao}
                          onChange={(e) => editar(idx, { descricao: e.target.value })}
                          placeholder="Descrição no cupom"
                          className={inputCls}
                        />
                      ) : (
                        <p className="text-sm font-medium text-[var(--text-primary)]">
                          {l.descricao}
                          {l.codigo ? (
                            <span className="ml-2 text-xs font-normal text-[var(--text-secondary)]">cód. {l.codigo}</span>
                          ) : null}
                        </p>
                      )}
                      {l.valor_unitario !== null ? (
                        <p className="mt-0.5 text-xs tabular-nums text-[var(--text-secondary)]">
                          No cupom: {valido(l.quantidade) ? num(l.quantidade) : "?"} {l.unidade} ×{" "}
                          {formatMoney(l.valor_unitario)}
                          {valido(l.quantidade) ? ` = ${formatMoney(num(l.quantidade) * l.valor_unitario)}` : ""}
                          {" · preço de compra, só para conferir"}
                        </p>
                      ) : null}
                    </div>
                    <label className="flex shrink-0 items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                      <input
                        type="checkbox"
                        checked={l.ignorar}
                        onChange={(e) => editar(idx, { ignorar: e.target.checked })}
                      />
                      Ignorar
                    </label>
                  </div>

                  {!l.ignorar ? (
                    <div className="mt-2 grid grid-cols-[4.5rem_6rem_1fr] gap-2">
                      <label className="text-[11px] uppercase tracking-wide text-[var(--text-secondary)]">
                        Qtde.
                        <input
                          inputMode="decimal"
                          value={l.quantidade}
                          onChange={(e) => editar(idx, { quantidade: e.target.value })}
                          className={`mt-0.5 tabular-nums ${inputCls}`}
                        />
                      </label>
                      <label
                        className="text-[11px] uppercase tracking-wide text-[var(--text-secondary)]"
                        title="Quantas unidades de prateleira vêm em cada unidade do cupom (1 fardo = 6, 1 display = 24)"
                      >
                        Un. por emb.
                        <input
                          inputMode="decimal"
                          value={l.fator}
                          onChange={(e) => editar(idx, { fator: e.target.value })}
                          className={`mt-0.5 tabular-nums ${inputCls}`}
                        />
                      </label>
                      <label className="min-w-0 text-[11px] uppercase tracking-wide text-[var(--text-secondary)]">
                        Produto no sistema
                        {l.vinculo === "lembrado" ? <span className="ml-1 normal-case">· lembrado</span> : null}
                        <ProductPicker
                          produtos={produtosDaLoja}
                          value={l.product_id}
                          sugestoes={l.sugestoes}
                          destacado={falta}
                          onChange={(id) => editar(idx, { product_id: id, vinculo: null, novo: false })}
                          onCadastrar={() => setCadastrando(idx)}
                        />
                      </label>
                    </div>
                  ) : null}

                  {!l.ignorar && falta && l.sugestoes[0] && nomeProduto.has(l.sugestoes[0]) ? (
                    <p className="mt-1.5 text-xs text-[var(--text-secondary)]">
                      Parece ser <strong className="text-[var(--text-primary)]">{nomeProduto.get(l.sugestoes[0])}</strong>{" "}
                      <button
                        type="button"
                        onClick={() => editar(idx, { product_id: l.sugestoes[0] })}
                        className="underline"
                      >
                        usar
                      </button>
                    </p>
                  ) : null}
                  {!l.ignorar && l.novo ? (
                    <p className="mt-1.5 text-xs text-[var(--status-warning)]">
                      Produto recém-cadastrado: inclua-o no planograma da máquina na VMpay antes de
                      aprovar — fora do planograma a VMpay recusa a carga do cupom inteiro.
                    </p>
                  ) : null}
                  {!l.ignorar && l.product_id && valido(l.quantidade) && valido(l.fator) && num(l.fator) !== 1 ? (
                    <p className="mt-1.5 text-xs tabular-nums text-[var(--text-secondary)]">
                      Entram {num(l.quantidade) * num(l.fator)} unidades
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>

          {consulta.origem === "manual" ? (
            <button
              type="button"
              onClick={() => setLinhas((ls) => [...ls, linhaVazia(Math.max(0, ...ls.map((x) => x.linha)) + 1)])}
              className={`mt-2 ${botaoSecundario}`}
            >
              Adicionar item
            </button>
          ) : null}

          {erro ? (
            <p role="alert" className="mt-4 text-sm text-[var(--status-critical)]">
              {erro}
            </p>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--grid)] pt-4">
            <p className="text-sm text-[var(--text-secondary)]">
              <span className="tabular-nums text-[var(--text-primary)]">{totalUnidades}</span> unidades entram
              {pendencias > 0 ? (
                <span className="text-[var(--status-warning)]"> · {pendencias} item(ns) sem produto</span>
              ) : null}
              {!localId ? <span className="text-[var(--status-warning)]"> · escolha o local</span> : null}
            </p>
            <button type="button" onClick={aprovar} disabled={!podeAprovar} className={botaoPrimario}>
              {busy ? "Carregando…" : "Aprovar e carregar"}
            </button>
          </div>
        </section>
      )}

      {!consulta && erro ? (
        <p role="alert" className="text-sm text-[var(--status-critical)]">
          {erro}
        </p>
      ) : null}

      {historico.length > 0 ? (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-[var(--text-primary)]">Cupons carregados</h2>
          <ul className="divide-y divide-[var(--grid)] rounded-xl border border-[var(--grid)] bg-[var(--surface-1)]">
            {historico.map((h) => (
              <li key={h.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 text-sm">
                <span className="min-w-0 text-[var(--text-primary)]">
                  {h.supplier_name || "Fornecedor"}
                  {h.number ? ` · NFC-e ${h.number}` : ""}
                  <span className="block text-xs text-[var(--text-secondary)]">
                    {formatDayTime(h.created_at)} · {h.location_name} · {h.itens} itens
                  </span>
                </span>
                <span className="text-xs text-[var(--text-secondary)]">
                  {h.total !== null ? `${formatMoney(h.total)} · ` : ""}
                  <span className={h.status === "approved" ? "" : "text-[var(--status-warning)]"}>
                    {STATUS_LABEL[h.status]}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

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
        const Ctor = (window as unknown as { BarcodeDetector: new (o: object) => Detector }).BarcodeDetector;
        const detector = new Ctor({ formats: ["qr_code"] });
        // 4 leituras por segundo bastam e poupam bateria frente a um quadro por frame.
        const ler = async () => {
          if (!ativo) return;
          try {
            const [achado] = await detector.detect(video);
            if (achado?.rawValue) {
              onLido(achado.rawValue);
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
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Ler QR Code"
      className="fixed inset-0 z-30 flex items-end justify-center bg-black/60 sm:items-center sm:p-4"
    >
      <div className="w-full rounded-t-xl border border-[var(--grid)] bg-[var(--surface-1)] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:max-w-md sm:rounded-xl">
        <h2 className="text-base font-semibold text-[var(--text-primary)]">Aponte para o QR Code do cupom</h2>
        {erro ? (
          <p role="alert" className="mt-3 text-sm text-[var(--status-critical)]">
            {erro}
          </p>
        ) : (
          <video ref={videoRef} muted playsInline className="mt-3 aspect-square w-full rounded-lg bg-black object-cover" />
        )}
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[var(--grid)] px-4 py-2.5 text-sm text-[var(--text-secondary)]"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
