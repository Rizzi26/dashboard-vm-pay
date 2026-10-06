"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ContaVmpay } from "@/lib/api";
import { Paginacao, usePaginacao } from "@/components/Paginacao";
import { browserApi } from "@/lib/api";
import { formatAtraso } from "@/lib/format";
import { Botao } from "@/components/ui/Botao";
import { Cartao } from "@/components/ui/Cartao";
import { Lista } from "@/components/ui/Lista";
import { Folha } from "@/components/ui/Folha";
import { Selo } from "@/components/ui/Selo";
import { IconeMaisSinal } from "@/components/ui/icones";
import { supabaseBrowser } from "@/lib/supabase/browser";

async function token(): Promise<string> {
  const { data } = await supabaseBrowser().auth.getSession();
  if (!data.session) throw new Error("sessão expirada — entre de novo");
  return data.session.access_token;
}

function idade(iso: string | null): number | null {
  return iso ? Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000)) : null;
}

/** Classes dos campos de formulário da proposta (campo de 48px, 16px de fonte: o iOS não dá zoom). */
const CAMPO =
  "mt-1.5 block h-12 w-full rounded-xl border border-campo-borda bg-campo px-3.5 text-[16px] text-texto outline-none focus:border-azul";
const ROTULO = "mt-4 block text-[13px] text-sec";

function BotoesFolha({ busy, rotulo, ocupado, onClose }: { busy: boolean; rotulo: string; ocupado: string; onClose: () => void }) {
  return (
    <div className="mt-5 flex gap-2.5 md:justify-end">
      <Botao onClick={onClose} className="flex-1 md:flex-none">
        Cancelar
      </Botao>
      <Botao type="submit" variante="cheio" disabled={busy} className="flex-1 md:flex-none">
        {busy ? ocupado : rotulo}
      </Botao>
    </div>
  );
}

/**
 * Cartão tracejado "Adicionar loja" que fecha a grade de lojas no computador.
 * Abre o mesmo modal do botão das Contas VMpay; o aviso de sucesso (a
 * importação demora) fica no próprio cartão até a lista atualizar.
 */
export function CartaoAdicionarLoja({ org, className = "" }: { org: string; className?: string }) {
  const router = useRouter();
  const [abrindo, setAbrindo] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => setAbrindo(true)}
        className={`flex min-h-[210px] w-full flex-col items-center justify-center gap-2.5 rounded-[22px] border-[1.5px] border-dashed border-tracejado bg-vidro-fraco p-[22px] font-[inherit] text-sec hover:bg-[var(--row-hover)] ${className}`}
      >
        <span aria-hidden="true" className="flex h-11 w-11 items-center justify-center rounded-full bg-azul-tinta text-azul">
          <IconeMaisSinal tamanho={22} espessura={2.4} />
        </span>
        <span className="text-[16px] font-semibold text-texto">Adicionar loja</span>
        <span role={aviso ? "status" : undefined} className="max-w-[260px] text-center text-[13px]">
          {aviso ?? "Loja em outra conta VMpay: cole o token da conta e ela entra aqui."}
        </span>
      </button>
      {abrindo ? (
        <NovaContaModal
          org={org}
          onClose={() => setAbrindo(false)}
          onCriada={(msg) => {
            setAbrindo(false);
            setAviso(msg);
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}

/**
 * Contas VMpay do lojista. Cada mercadinho pode estar numa conta VMpay
 * própria; adicionar = colar o token daquela conta. O token vai para o cofre
 * do servidor e nunca volta para a tela.
 */
export function ContasVmpay({ org, contas }: { org: string; contas: ContaVmpay[] }) {
  const router = useRouter();
  const [abrindo, setAbrindo] = useState(false);
  const [trocando, setTrocando] = useState<ContaVmpay | null>(null);
  const pagContas = usePaginacao(contas, 10);
  const [aviso, setAviso] = useState<string | null>(null);

  async function desativar(c: ContaVmpay) {
    if (!confirm(`Desativar a conta "${c.nome}"? As lojas dela param de atualizar; o histórico fica.`)) return;
    const resp = await browserApi.request(`/orgs/${org}/contas/${c.id}`, await token(), {
      method: "PATCH",
      body: JSON.stringify({ ativo: false }),
    });
    const payload = await resp.json().catch(() => ({}));
    setAviso(resp.ok ? `Conta "${c.nome}" desativada.` : (payload.detail ?? `backend respondeu ${resp.status}`));
    router.refresh();
  }

  return (
    // id: âncora de "Contas VMpay" na tela Mais (/#contas).
    <Cartao
      id="contas"
      className="mt-4 scroll-mt-28"
      titulo="Contas VMpay"
      subtitulo="Cada loja pode estar numa conta VMpay diferente. Todas aparecem juntas aqui."
      // No computador quem adiciona é o cartão tracejado da grade de lojas;
      // no celular (que chega aqui pelo Mais) o botão é este.
      acoes={
        <Botao tamanho="p" icone={<IconeMaisSinal tamanho={16} />} onClick={() => setAbrindo(true)} className="md:hidden">
          Adicionar loja
        </Botao>
      }
    >
      {aviso ? (
        <p role="status" className="mb-3 flex items-start justify-between gap-3 rounded-xl bg-azul-tinta px-3.5 py-2.5 text-[14px] text-texto">
          <span>{aviso}</span>
          <button type="button" className="min-h-11 shrink-0 border-0 bg-transparent text-[13px] text-azul-texto md:min-h-0" onClick={() => setAviso(null)}>
            fechar
          </button>
        </p>
      ) : null}

      <Lista rotulo="Contas VMpay">
        {pagContas.visiveis.map((c) => {
          const lida = idade(c.ultima_leitura);
          return (
            <li key={c.id} className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-[13px] ${c.ativa ? "" : "opacity-50"}`}>
              <div className="min-w-0 flex-1">
                <p className="m-0 flex flex-wrap items-center gap-2 text-[16px] text-texto md:text-[15px]">
                  <span className="break-words font-medium">{c.nome}</span>
                  {c.principal ? <Selo tom="azul">principal</Selo> : null}
                  {!c.ativa ? <Selo tom="cinza">desativada</Selo> : null}
                </p>
                {c.ativa && !c.token_no_cofre ? (
                  <p className="m-0 mt-0.5 text-[13px] text-laranja-texto">
                    ▲ token fora do cofre (variável de ambiente) — troque o token para movê-lo
                  </p>
                ) : null}
                <p className="m-0 mt-0.5 text-[13px] text-sec">
                  {c.lojas.length ? c.lojas.join(" · ") : "nenhuma loja ainda"}
                  {" · "}
                  {c.erro ? (
                    <span className="text-vermelho-texto">■ erro na última leitura</span>
                  ) : lida === null ? (
                    <span className="text-laranja-texto">▲ importando…</span>
                  ) : (
                    <>lida {formatAtraso(lida)}</>
                  )}
                </p>
              </div>
              {c.ativa ? (
                <span className="flex gap-1">
                  <Botao variante="texto" tamanho="p" onClick={() => setTrocando(c)}>
                    Trocar token
                  </Botao>
                  {!c.principal ? (
                    <Botao variante="perigo" tamanho="p" onClick={() => desativar(c)}>
                      Desativar
                    </Botao>
                  ) : null}
                </span>
              ) : null}
            </li>
          );
        })}
      </Lista>
      <Paginacao {...pagContas.rodape} rotulo="contas" />

      {trocando ? (
        <TrocarTokenModal
          org={org}
          conta={trocando}
          onClose={() => setTrocando(null)}
          onTrocado={(msg) => {
            setTrocando(null);
            setAviso(msg);
            router.refresh();
          }}
        />
      ) : null}

      {abrindo ? (
        <NovaContaModal
          org={org}
          onClose={() => setAbrindo(false)}
          onCriada={(msg) => {
            setAbrindo(false);
            setAviso(msg);
            router.refresh();
          }}
        />
      ) : null}
    </Cartao>
  );
}

function NovaContaModal({
  org,
  onClose,
  onCriada,
}: {
  org: string;
  onClose: () => void;
  onCriada: (mensagem: string) => void;
}) {
  const [nome, setNome] = useState("");
  const [segredo, setSegredo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!nome.trim() || segredo.trim().length < 10) {
      setErro("Preencha o nome da loja e cole o token inteiro.");
      return;
    }
    setBusy(true);
    setErro(null);
    try {
      const resp = await browserApi.request(`/orgs/${org}/contas`, await token(), {
        method: "POST",
        body: JSON.stringify({ nome: nome.trim(), token: segredo }),
      });
      const payload = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const detalhe = Array.isArray(payload.detail)
          ? payload.detail.map((d: { msg: string }) => d.msg).join("; ")
          : payload.detail;
        throw new Error(detalhe ?? `backend respondeu ${resp.status}`);
      }
      setSegredo("");
      onCriada(
        `Conta "${payload.nome}" conectada — ${payload.maquinas} máquina${payload.maquinas === 1 ? "" : "s"} encontrada${payload.maquinas === 1 ? "" : "s"}. ` +
          "A importação de vendas e estoque roda agora e pode levar alguns minutos; as lojas aparecem na Central quando terminar.",
      );
    } catch (err) {
      setErro(err instanceof Error ? err.message : "falha ao conectar a conta");
      setBusy(false);
    }
  }

  return (
    <Folha
      titulo="Adicionar loja"
      subtitulo="Para uma loja que está em outra conta VMpay (outro email de operador). Se a máquina nova está na mesma conta de uma loja que já aparece aqui, não precisa: ela entra sozinha na próxima atualização."
      onFechar={onClose}
      onSubmit={enviar}
      largura="md:max-w-md"
    >

      <label className={ROTULO}>
        Nome da loja
        <input autoFocus value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Jardins III" className={`${CAMPO} placeholder:text-terc`} />
      </label>

      <label className={ROTULO}>
        Token de API da conta VMpay
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={segredo}
          onChange={(e) => setSegredo(e.target.value)}
          className={`${CAMPO} font-mono`}
        />
      </label>
      <p className="m-0 mt-1.5 text-[13px] text-sec">
        O token é testado na VMpay antes de salvar e fica guardado cifrado no servidor — ninguém
        consegue vê-lo de novo pelo painel. Não envie o token por WhatsApp ou email.
      </p>

      {erro ? (
        <p role="alert" className="m-0 mt-3 text-[14px] text-vermelho-texto">
          ■ {erro}
        </p>
      ) : null}

      <BotoesFolha busy={busy} rotulo="Conectar" ocupado="Testando na VMpay…" onClose={onClose} />
    </Folha>
  );
}

function TrocarTokenModal({
  org,
  conta,
  onClose,
  onTrocado,
}: {
  org: string;
  conta: ContaVmpay;
  onClose: () => void;
  onTrocado: (mensagem: string) => void;
}) {
  const [segredo, setSegredo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (segredo.trim().length < 10) {
      setErro("Cole o token inteiro.");
      return;
    }
    setBusy(true);
    setErro(null);
    try {
      const resp = await browserApi.request(`/orgs/${org}/contas/${conta.id}`, await token(), {
        method: "PATCH",
        body: JSON.stringify({ token: segredo }),
      });
      const payload = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const detalhe = Array.isArray(payload.detail)
          ? payload.detail.map((d: { msg: string }) => d.msg).join("; ")
          : payload.detail;
        throw new Error(detalhe ?? `backend respondeu ${resp.status}`);
      }
      setSegredo("");
      onTrocado(
        payload.cofre
          ? `Token da conta "${conta.nome}" trocado e guardado no cofre. Pode revogar o token antigo na VMpay.`
          : `Token da conta "${conta.nome}" trocado. Pode revogar o token antigo na VMpay.`,
      );
    } catch (err) {
      setErro(err instanceof Error ? err.message : "falha ao trocar o token");
      setBusy(false);
    }
  }

  return (
    <Folha
      titulo={`Trocar token — ${conta.nome}`}
      subtitulo={
        "Gere um token novo na VMpay desta conta e cole aqui. Ele é testado antes de salvar e " +
        "precisa enxergar as mesmas máquinas desta conta. Depois, revogue o token antigo na VMpay." +
        (!conta.token_no_cofre ? " O token passa a ficar guardado cifrado no cofre do servidor." : "")
      }
      onFechar={onClose}
      onSubmit={enviar}
      largura="md:max-w-md"
    >
      <label className={ROTULO}>
        Token novo
        <input
          autoFocus
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={segredo}
          onChange={(e) => setSegredo(e.target.value)}
          className={`${CAMPO} font-mono`}
        />
      </label>
      {erro ? (
        <p role="alert" className="m-0 mt-3 text-[14px] text-vermelho-texto">
          ■ {erro}
        </p>
      ) : null}
      <BotoesFolha busy={busy} rotulo="Trocar token" ocupado="Testando na VMpay…" onClose={onClose} />
    </Folha>
  );
}
