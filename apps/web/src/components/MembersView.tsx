"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { MemberRow } from "@/lib/api";
import { browserApi } from "@/lib/api";
import { supabaseBrowser } from "@/lib/supabase/browser";

const PAPEIS = [
  { value: "viewer", label: "leitura" },
  { value: "admin", label: "operação" },
  { value: "master", label: "master" },
] as const;

export function MembersView({
  rows,
  org,
  selfId,
}: {
  rows: MemberRow[];
  org: string;
  selfId: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [papel, setPapel] = useState("viewer");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function token(): Promise<string> {
    const { data } = await supabaseBrowser().auth.getSession();
    if (!data.session) throw new Error("sessão expirada — entre de novo");
    return data.session.access_token;
  }

  async function api(path: string, init?: RequestInit) {
    const resp = await browserApi.request(`/orgs/${org}${path}`, await token(), init);
    if (!resp.ok) {
      const payload = await resp.json().catch(() => ({}));
      throw new Error(payload.detail ?? `backend respondeu ${resp.status}`);
    }
    return resp;
  }

  async function convidar(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      await api("/members", { method: "POST", body: JSON.stringify({ email, role: papel }) });
      setFeedback(`Convite enviado para ${email}.`);
      setEmail("");
      router.refresh();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "falha no convite");
    } finally {
      setBusy(false);
    }
  }

  async function mudarPapel(userId: string, role: string) {
    setFeedback(null);
    try {
      await api(`/members/${userId}`, { method: "PATCH", body: JSON.stringify({ role }) });
      router.refresh();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "falha ao mudar papel");
    }
  }

  async function remover(userId: string, emailAlvo: string) {
    if (!window.confirm(`Remover o acesso de ${emailAlvo}?`)) return;
    setFeedback(null);
    try {
      await api(`/members/${userId}`, { method: "DELETE" });
      router.refresh();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "falha ao remover");
    }
  }

  return (
    <div>
      <form
        onSubmit={convidar}
        className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-[var(--grid)] p-4"
      >
        <label className="grow text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">
          Email do convidado
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-md border border-[var(--grid)] bg-transparent px-3 py-2 text-base text-[var(--text-primary)] focus:border-[var(--accent)] sm:text-sm"
          />
        </label>
        <label className="text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">
          Papel
          <select
            value={papel}
            onChange={(e) => setPapel(e.target.value)}
            className="mt-1 block rounded-md border border-[var(--grid)] bg-transparent px-3 py-2 text-base text-[var(--text-primary)] sm:text-sm"
          >
            {PAPEIS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-contrast)] disabled:opacity-60"
        >
          {busy ? "Convidando…" : "Convidar"}
        </button>
      </form>

      {feedback ? (
        <p role="status" className="mb-4 text-sm text-[var(--text-primary)]">
          {feedback}
        </p>
      ) : null}

      <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--grid)] text-left text-[11px] uppercase tracking-[0.08em] text-[var(--text-secondary)]">
            <th className="py-2.5 font-medium">Email</th>
            <th className="py-2.5 font-medium">Papel</th>
            <th className="hidden py-2.5 font-medium sm:table-cell">Desde</th>
            <th className="py-2.5 text-right font-medium">Ações</th>
          </tr>
        </thead>
        <tbody className="text-[var(--text-primary)]">
          {rows.map((m) => {
            const self = m.user_id === selfId;
            return (
              <tr
                key={m.user_id}
                className="border-t border-[var(--grid)] hover:bg-[var(--row-hover)]"
              >
                <td className="py-2.5">
                  {m.email}
                  {self ? (
                    <span className="ml-2 text-xs text-[var(--text-secondary)]">(você)</span>
                  ) : null}
                </td>
                <td className="py-2.5">
                  {self ? (
                    <span className="text-[var(--text-secondary)]">
                      {PAPEIS.find((p) => p.value === m.role)?.label ?? m.role}
                    </span>
                  ) : (
                    <select
                      value={m.role}
                      onChange={(e) => mudarPapel(m.user_id, e.target.value)}
                      className="rounded-md border border-[var(--grid)] bg-transparent px-2 py-1 text-base sm:text-sm"
                    >
                      {PAPEIS.map((p) => (
                        <option key={p.value} value={p.value}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                <td className="hidden py-2.5 text-[var(--text-secondary)] sm:table-cell">
                  {new Date(m.member_since).toLocaleDateString("pt-BR")}
                </td>
                <td className="py-2.5 text-right">
                  {self ? null : (
                    <button
                      type="button"
                      onClick={() => remover(m.user_id, m.email)}
                      className="text-xs text-[var(--status-critical)] underline underline-offset-2"
                    >
                      remover
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}
