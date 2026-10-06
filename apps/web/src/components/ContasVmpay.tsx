"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ContaVmpay } from "@/lib/api";
import { Paginacao, usePaginacao } from "@/components/Paginacao";
import { browserApi } from "@/lib/api";
import { formatAtraso } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase/browser";

async function token(): Promise<string> {
  const { data } = await supabaseBrowser().auth.getSession();
  if (!data.session) throw new Error("sessão expirada — entre de novo");
  return data.session.access_token;
}

function idade(iso: string | null): number | null {
  return iso ? Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000)) : null;
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
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Contas VMpay</h2>
          <p className="text-xs text-[var(--text-secondary)]">
            Cada loja pode estar numa conta VMpay diferente. Todas aparecem juntas aqui.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAbrindo(true)}
          className="rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-[var(--accent-contrast)]"
        >
          + Adicionar loja
        </button>
      </div>

      {aviso ? (
        <p role="status" className="mb-3 rounded-md border border-[var(--grid)] px-3 py-2 text-sm text-[var(--text-primary)]">
          {aviso}
          <button type="button" className="ml-3 text-xs text-[var(--text-secondary)] underline" onClick={() => setAviso(null)}>
            fechar
          </button>
        </p>
      ) : null}

      <ul className="divide-y divide-[var(--grid)] rounded-xl border border-[var(--grid)] bg-[var(--surface-1)]">
        {pagContas.visiveis.map((c) => {
          const lida = idade(c.ultima_leitura);
          return (
            <li key={c.id} className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 ${c.ativa ? "" : "opacity-50"}`}>
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--text-primary)]">
                  {c.nome}
                  {c.principal ? <span className="ml-2 text-xs font-normal text-[var(--text-secondary)]">principal</span> : null}
                  {!c.ativa ? <span className="ml-2 text-xs font-normal text-[var(--text-secondary)]">desativada</span> : null}
                </p>
                {c.ativa && !c.token_no_cofre ? (
                  <p className="text-xs text-[var(--status-warning)]">
                    ▲ token fora do cofre (variável de ambiente) — troque o token para movê-lo
                  </p>
                ) : null}
                <p className="text-xs text-[var(--text-secondary)]">
                  {c.lojas.length ? c.lojas.join(" · ") : "nenhuma loja ainda"}
                  {" · "}
                  {c.erro ? (
                    <span className="text-[var(--status-critical)]">■ erro na última leitura</span>
                  ) : lida === null ? (
                    <span className="text-[var(--status-warning)]">▲ importando…</span>
                  ) : (
                    <>lida {formatAtraso(lida)}</>
                  )}
                </p>
              </div>
              {c.ativa ? (
                <span className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setTrocando(c)}
                    className="text-xs text-[var(--text-secondary)] underline hover:text-[var(--text-primary)]"
                  >
                    trocar token
                  </button>
                  {!c.principal ? (
                    <button
                      type="button"
                      onClick={() => desativar(c)}
                      className="text-xs text-[var(--text-secondary)] underline hover:text-[var(--text-primary)]"
                    >
                      desativar
                    </button>
                  ) : null}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
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
    </section>
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

  const campo =
    "mt-1 w-full rounded-md border border-[var(--grid)] bg-transparent px-3 py-2 text-base text-[var(--text-primary)] focus:border-[var(--accent)] sm:text-sm";

  return (
    <div role="dialog" aria-modal="true" aria-label="Adicionar loja" className="fixed inset-0 z-30 flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
      <form
        onSubmit={enviar}
        className="w-full rounded-t-xl border border-[var(--grid)] bg-[var(--surface-1)] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-[var(--shadow-card)] sm:max-w-md sm:rounded-xl"
      >
        <h2 className="text-base font-semibold text-[var(--text-primary)]">Adicionar loja</h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Para uma loja que está em outra conta VMpay (outro email de operador). Se a máquina
          nova está na mesma conta de uma loja que já aparece aqui, não precisa: ela entra
          sozinha na próxima atualização.
        </p>

        <label className="mt-4 block text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">
          Nome da loja
          <input autoFocus value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Jardins III" className={campo} />
        </label>

        <label className="mt-3 block text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">
          Token de API da conta VMpay
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={segredo}
            onChange={(e) => setSegredo(e.target.value)}
            className={`${campo} font-mono`}
          />
        </label>
        <p className="mt-1.5 text-xs text-[var(--text-secondary)]">
          O token é testado na VMpay antes de salvar e fica guardado cifrado no servidor — ninguém
          consegue vê-lo de novo pelo painel. Não envie o token por WhatsApp ou email.
        </p>

        {erro ? (
          <p role="alert" className="mt-3 text-sm text-[var(--status-critical)]">
            {erro}
          </p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border border-[var(--grid)] px-4 py-2.5 text-sm text-[var(--text-secondary)]">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-[var(--accent-contrast)] disabled:opacity-60"
          >
            {busy ? "Testando na VMpay…" : "Conectar"}
          </button>
        </div>
      </form>
    </div>
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
    <div role="dialog" aria-modal="true" aria-label="Trocar token" className="fixed inset-0 z-30 flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
      <form
        onSubmit={enviar}
        className="w-full rounded-t-xl border border-[var(--grid)] bg-[var(--surface-1)] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-[var(--shadow-card)] sm:max-w-md sm:rounded-xl"
      >
        <h2 className="text-base font-semibold text-[var(--text-primary)]">Trocar token — {conta.nome}</h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Gere um token novo na VMpay desta conta e cole aqui. Ele é testado antes de salvar e
          precisa enxergar as mesmas máquinas desta conta. Depois, revogue o token antigo na VMpay.
          {!conta.token_no_cofre ? " O token passa a ficar guardado cifrado no cofre do servidor." : ""}
        </p>
        <label className="mt-4 block text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">
          Token novo
          <input
            autoFocus
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={segredo}
            onChange={(e) => setSegredo(e.target.value)}
            className="mt-1 w-full rounded-md border border-[var(--grid)] bg-transparent px-3 py-2 font-mono text-base text-[var(--text-primary)] focus:border-[var(--accent)] sm:text-sm"
          />
        </label>
        {erro ? (
          <p role="alert" className="mt-3 text-sm text-[var(--status-critical)]">
            {erro}
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border border-[var(--grid)] px-4 py-2.5 text-sm text-[var(--text-secondary)]">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-[var(--accent-contrast)] disabled:opacity-60"
          >
            {busy ? "Testando na VMpay…" : "Trocar token"}
          </button>
        </div>
      </form>
    </div>
  );
}
