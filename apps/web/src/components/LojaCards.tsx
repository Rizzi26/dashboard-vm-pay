"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { LojaCard } from "@/lib/api";
import { browserApi } from "@/lib/api";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { escolherLoja } from "@/components/LojaSelector";
import { Botao, classesBotao } from "@/components/ui/Botao";
import { Selo, type TomSelo } from "@/components/ui/Selo";
import { Lista } from "@/components/ui/Lista";
import { Chevron } from "@/components/ui/icones";
import { formatAtraso, formatInt, formatMoney } from "@/lib/format";

function idadeSeg(iso: string | null): number | null {
  return iso ? Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000)) : null;
}

// Um dia inteiro sem venda já é sinal (máquina parada, cartão fora do ar); uma
// madrugada sem venda não é. Abaixo disso a loja está "vendendo".
const PARADA_SEG = 24 * 3600;

function status(l: LojaCard): { tom: TomSelo; texto: string; cor: string } {
  const ha = idadeSeg(l.vendas.ultima_venda);
  if (ha === null) return { tom: "vermelho", texto: "Sem vendas em 30 dias", cor: "bg-vermelho" };
  if (ha > PARADA_SEG) return { tom: "laranja", texto: `Sem vendas ${formatAtraso(ha)}`, cor: "bg-laranja" };
  return { tom: "verde", texto: "Vendendo", cor: "bg-verde" };
}

function Ruptura({ l }: { l: LojaCard }) {
  const { zerados, acabando } = l.estoque;
  if (zerados > 0 || acabando > 0) {
    return (
      <span className="text-laranja-texto">
        ▲ {formatInt(zerados)} zerado{zerados === 1 ? "" : "s"} · {formatInt(acabando)} acabando
      </span>
    );
  }
  return <span className="text-verde-texto">● prateleira sem rupturas</span>;
}

function useEntrar() {
  const router = useRouter();
  // Entrar numa loja = escolhê-la (cookie) e ir; null volta para "todas".
  return (id: string | null, destino: string) => {
    escolherLoja(id);
    router.push(destino);
    router.refresh();
  };
}

/**
 * Cartões das lojas no computador (central() da proposta). Os botões entram NA
 * loja. `extra` é o cartão tracejado de "Adicionar loja", que fecha a grade.
 * `contaDe` (só para master, que enxerga as contas) diz de que conta VMpay a
 * loja vem.
 */
export function LojaCards({
  lojas,
  contaDe = {},
  extra,
  orgMaster = null,
}: {
  lojas: LojaCard[];
  contaDe?: Record<string, string>;
  extra?: ReactNode;
  /** Slug da organização quando quem vê é master: mostra o modo da carga. */
  orgMaster?: string | null;
}) {
  const entrar = useEntrar();

  return (
    <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 lg:grid-cols-2">
      {lojas.map((l) => {
        const semVendaHa = idadeSeg(l.vendas.ultima_venda);
        const s = status(l);
        const conta = contaDe[l.nome];
        return (
          <li key={l.id} className="vidro flex min-w-0 flex-col rounded-[22px] p-[22px]">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="m-0 break-words text-[17px] font-semibold text-texto">{l.nome}</h3>
                <p className="m-0 mt-[3px] text-[13px] text-sec">
                  {semVendaHa === null ? "Sem vendas em 30 dias" : `Última venda ${formatAtraso(semVendaHa)}`}
                  {conta ? ` · ${conta}` : ""}
                </p>
              </div>
              <Selo tom={s.tom} className="shrink-0">
                {s.texto}
              </Selo>
            </div>

            <dl className="m-0 mt-[18px] grid grid-cols-3 gap-3">
              <div className="min-w-0">
                <dt className="text-[12px] text-sec">Hoje</dt>
                <dd className="m-0 mt-0.5 break-words text-[22px] font-bold tabular-nums text-texto">
                  {formatMoney(l.vendas.hoje)}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[12px] text-sec">7 dias</dt>
                <dd className="m-0 mt-0.5 break-words text-[17px] font-semibold tabular-nums text-texto">
                  {formatMoney(l.vendas.d7)}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[12px] text-sec">30 dias</dt>
                <dd className="m-0 mt-0.5 break-words text-[17px] font-semibold tabular-nums text-texto">
                  {formatMoney(l.vendas.d30)}
                </dd>
              </div>
            </dl>

            <div className="mt-[18px] h-px bg-sep" />
            <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2.5">
              <span className="text-[13px] font-medium">
                <Ruptura l={l} />
              </span>
              <div className="flex gap-2">
                <Botao tamanho="p" onClick={() => entrar(l.id, "/vendas")}>
                  Vendas
                </Botao>
                <Botao tamanho="p" variante="cheio" onClick={() => entrar(l.id, "/reposicao")}>
                  O que repor
                </Botao>
              </div>
            </div>
            {orgMaster ? <ModoCarga org={orgMaster} loja={l} /> : null}
          </li>
        );
      })}
      {extra ? <li className="flex min-w-0">{extra}</li> : null}
    </ul>
  );
}

/**
 * Lista de lojas do celular (cel_central() da proposta): bolinha de status,
 * rupturas embaixo do nome e o faturamento de hoje à direita. Tocar entra na
 * loja pelas Vendas, como o botão do cartão no computador.
 */
export function LojaLista({ lojas }: { lojas: LojaCard[] }) {
  const entrar = useEntrar();
  return (
    <Lista rotulo="Lojas">
      {lojas.map((l) => {
        const s = status(l);
        return (
          <li key={l.id}>
            <button
              type="button"
              onClick={() => entrar(l.id, "/vendas")}
              className="flex min-h-11 w-full items-center gap-3 border-0 bg-transparent px-4 py-[13px] text-left font-[inherit] text-texto hover:bg-[var(--row-hover)]"
            >
              <span className={`h-[9px] w-[9px] shrink-0 rounded-full ${s.cor}`} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block break-words text-[16px]">{l.nome}</span>
                {/* A bolinha não carrega o status sozinha: fora do "vendendo",
                    o texto com símbolo vem junto. */}
                {s.tom !== "verde" ? (
                  <span className={`block text-[13px] ${s.tom === "vermelho" ? "text-vermelho-texto" : "text-laranja-texto"}`}>
                    {s.tom === "vermelho" ? "■" : "▲"} {s.texto}
                  </span>
                ) : (
                  <span className="sr-only">Vendendo. </span>
                )}
                <span className="block text-[13px]">
                  <Ruptura l={l} />
                </span>
              </span>
              <span className="shrink-0 text-[16px] font-semibold tabular-nums">{formatMoney(l.vendas.hoje)}</span>
              <Chevron />
            </button>
          </li>
        );
      })}
    </Lista>
  );
}

/** "O que repor hoje" do celular: a Reposição de todas as lojas. */
export function BotaoReporHoje() {
  const entrar = useEntrar();
  return (
    <button
      type="button"
      onClick={() => entrar(null, "/reposicao")}
      className={`${classesBotao({ variante: "cheio", tamanho: "g", largo: true })} font-[inherit]`}
    >
      O que repor hoje
    </button>
  );
}

/**
 * Como a carga do painel chega à VMpay nesta loja. Ligado: pick list +
 * reabastecimento — aparece como CARREGAMENTO, como quem lança na VMpay.
 * Desligado: ajuste de inventário (o saldo fica certo, mas aparece como
 * ajuste). Só master: muda toda carga da loja, e vai para a auditoria.
 */
function ModoCarga({ org, loja }: { org: string; loja: LojaCard }) {
  const router = useRouter();
  const [ligado, setLigado] = useState(!!loja.carga_como_carregamento);
  const [erro, setErro] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function mudar(valor: boolean) {
    setBusy(true);
    setErro(null);
    try {
      const { data } = await supabaseBrowser().auth.getSession();
      if (!data.session) throw new Error("sessão expirada — entre de novo");
      const resp = await browserApi.request(`/orgs/${org}/lojas/${loja.id}/modo-carga`, data.session.access_token, {
        method: "PATCH",
        body: JSON.stringify({ carga_como_carregamento: valor }),
      });
      const payload = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(payload.detail ?? `backend respondeu ${resp.status}`);
      setLigado(valor);
      router.refresh();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "falha ao mudar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3.5 rounded-xl bg-lista px-3 py-2.5 text-[13px]">
      <label className="flex items-center gap-2 text-texto">
        <input type="checkbox" checked={ligado} disabled={busy} onChange={(e) => mudar(e.target.checked)} />
        Carga entra na VMpay como <strong>carregamento</strong> (pick list)
      </label>
      <p className="m-0 mt-1 text-sec">
        {ligado
          ? "Repor, cupom e carga manual criam uma pick list e reabastecem — aparece como carregamento na VMpay."
          : "Hoje entra como ajuste de inventário: o saldo fica certo, mas na VMpay aparece como ajuste."}
      </p>
      {erro ? <p className="m-0 mt-1 text-vermelho-texto">■ {erro}</p> : null}
    </div>
  );
}
