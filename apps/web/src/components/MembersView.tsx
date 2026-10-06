"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { MemberRow } from "@/lib/api";
import { browserApi } from "@/lib/api";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { Paginacao, usePaginacao } from "@/components/Paginacao";
import { Botao } from "@/components/ui/Botao";
import { Cartao } from "@/components/ui/Cartao";
import { Lista } from "@/components/ui/Lista";
import { Selo } from "@/components/ui/Selo";

const PAPEIS = [
  { value: "viewer", label: "leitura" },
  { value: "admin", label: "operação" },
  { value: "master", label: "master" },
] as const;

// 16px no celular: abaixo disso o Safari do iPhone dá zoom ao focar o campo.
const CAMPO =
  "mt-1 block h-11 rounded-xl border border-campo-borda bg-campo px-3.5 text-[16px] text-texto placeholder:text-terc md:text-[15px]";

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
  const pagMembros = usePaginacao(rows, 20);
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
      const resp = await api("/members", {
        method: "POST",
        body: JSON.stringify({ email, role: papel }),
      });
      const { email_enviado } = (await resp.json().catch(() => ({}))) as {
        email_enviado?: "convite" | "redefinir" | null;
      };
      // A conta no login sobrevive à remoção da organização: quem volta recebe
      // o link de redefinir senha, não um convite — a mensagem diz qual saiu.
      setFeedback(
        email_enviado === "convite"
          ? `Convite enviado para ${email}.`
          : email_enviado === "redefinir"
            ? `${email} já tinha conta: o acesso voltou e foi enviado um email para definir a senha.`
            : `${email} já tinha conta e o acesso voltou, mas o email não saiu (limite de envio do Supabase). A pessoa pode entrar com a senha antiga ou usar "esqueci a senha" no login.`,
      );
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
    <>
      <Cartao compacto>
        <form onSubmit={convidar} className="flex flex-col gap-3 md:flex-row md:items-end">
          <label className="text-[13px] text-sec md:flex-1">
            Email do convidado
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="pessoa@email.com"
              className={`${CAMPO} w-full`}
            />
          </label>
          <label className="text-[13px] text-sec">
            Papel
            <select value={papel} onChange={(e) => setPapel(e.target.value)} className={`${CAMPO} w-full md:w-auto`}>
              {PAPEIS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <Botao type="submit" variante="cheio" disabled={busy} className="w-full md:h-11 md:w-auto">
            {busy ? "Convidando…" : "Convidar"}
          </Botao>
        </form>
      </Cartao>

      {feedback ? (
        <p role="status" className="m-0 px-1 text-[15px] text-texto">
          {feedback}
        </p>
      ) : null}

      {/* Texto conferido contra os require_role da API: viewer também pede a
          atualização dos dados; restock/preço/cadastro/sincronizar são admin;
          membros, contas VMpay e auditoria são master. */}
      <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1.5 px-1 text-[13px] text-sec">
        <span className="inline-flex items-center gap-2">
          <Selo tom="cinza" simbolo={null}>leitura</Selo> vê, exporta e atualiza os dados
        </span>
        <span aria-hidden="true" className="hidden md:inline">·</span>
        <span className="inline-flex items-center gap-2">
          <Selo tom="azul" simbolo={null}>operação</Selo> + pick list, reabastecimento, preço e cadastro
        </span>
        <span aria-hidden="true" className="hidden md:inline">·</span>
        <span className="inline-flex items-center gap-2">
          <Selo tom="verde" simbolo={null}>master</Selo> + usuários, contas VMpay e auditoria
        </span>
      </p>

      <div>
        <Lista rotulo="Pessoas com acesso">
          {pagMembros.visiveis.map((m) => {
            const self = m.user_id === selfId;
            const rotulo = PAPEIS.find((p) => p.value === m.role)?.label ?? m.role;
            return (
              // Linha própria em vez de LinhaLista: no celular os controles
              // descem para baixo do email, senão o select espreme o texto.
              <li key={m.user_id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-[13px]">
                <span
                  aria-hidden="true"
                  className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full font-semibold text-white"
                  style={{ background: "var(--avatar)" }}
                >
                  {m.email.charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-[16px] text-texto md:text-[15px]">{m.email}</span>
                  <span className="block text-[13px] text-sec">
                    {rotulo} · desde {new Date(m.member_since).toLocaleDateString("pt-BR")}
                  </span>
                </span>
                {self ? (
                  <Selo tom="cinza" simbolo={null}>
                    você
                  </Selo>
                ) : (
                  <span className="flex w-full items-center gap-1.5 pl-[50px] md:w-auto md:pl-0">
                    <select
                      aria-label={`Papel de ${m.email}`}
                      value={m.role}
                      onChange={(e) => mudarPapel(m.user_id, e.target.value)}
                      className="h-11 flex-1 rounded-[10px] border border-campo-borda bg-campo px-2.5 text-[16px] text-texto md:h-[34px] md:flex-none md:text-[14px]"
                    >
                      {PAPEIS.map((p) => (
                        <option key={p.value} value={p.value}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                    <Botao
                      variante="texto"
                      tamanho="p"
                      onClick={() => remover(m.user_id, m.email)}
                      className="text-vermelho-texto! hover:bg-vermelho-fundo!"
                    >
                      Remover
                    </Botao>
                  </span>
                )}
              </li>
            );
          })}
        </Lista>
        <Paginacao {...pagMembros.rodape} rotulo="pessoas" />
      </div>
    </>
  );
}
