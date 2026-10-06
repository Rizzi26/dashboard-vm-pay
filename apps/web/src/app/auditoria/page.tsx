import Link from "next/link";
import { redirect } from "next/navigation";
import { Header } from "@/components/Header";
import { Offline } from "@/components/Offline";
import type { EventoAuditoria } from "@/lib/api";
import { serverApi } from "@/lib/api.server";
import { orgSession } from "@/lib/org";

const PERIODOS = [
  { key: "1", label: "Hoje" },
  { key: "7", label: "7 dias" },
  { key: "30", label: "30 dias" },
  { key: "90", label: "90 dias" },
];

type Params = { usuario?: string; sessao?: string; dias?: string; antes?: string };

function texto(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}

/** A ação em português, com o "sobre o quê" que importa para quem audita. */
function descrever(e: EventoAuditoria, nomes: Map<string, string>): string {
  const a = e.alvo;
  const pessoa = (id: unknown) => nomes.get(texto(id)) ?? "usuário removido";
  switch (e.acao) {
    case "login":
      return "Entrou no painel";
    case "logout":
      return "Saiu do painel";
    case "picklist.consultar":
      return a.origem === "manual"
        ? `Consultou cupom só pela chave (lançamento manual) — ${texto(a.chave)}`
        : `Consultou cupom fiscal de ${texto(a.fornecedor) || "fornecedor"} — ${texto(a.itens)} itens`;
    case "picklist.approve":
      return `Aprovou carga de cupom no estoque — ${(a.items as unknown[] | undefined)?.length ?? 0} produtos`;
    case "stock.restock":
      return `Lançou reabastecimento — ${(a.items as unknown[] | undefined)?.length ?? 0} produtos`;
    case "stock.price":
      return `Alterou preço para R$ ${texto(a.price)}`;
    case "product.create":
      return `Cadastrou o produto "${texto(a.name)}"`;
    case "estoque.exportar":
      return `Exportou o estoque (${texto(a.linhas)} linhas)`;
    case "reposicao.exportar":
      return `Exportou a lista de reposição (${texto(a.linhas)} itens)`;
    case "dados.atualizar":
      return "Pediu atualização dos dados";
    case "usuarios.convidar":
      return `Convidou ${texto(a.email)} como ${texto(a.papel)}`;
    case "usuarios.papel":
      return `Mudou o papel de ${pessoa(a.user_id)} para ${texto(a.papel)}`;
    case "usuarios.remover":
      return `Removeu ${pessoa(a.user_id)} da organização`;
    default:
      return e.acao;
  }
}

/** "Chrome · macOS" a partir do user-agent — o suficiente para reconhecer o aparelho. */
function aparelho(ua: string | null): string | null {
  if (!ua) return null;
  const nav = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "navegador";
  const so = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return so ? `${nav} · ${so}` : nav;
}

/** Fora do componente: o "agora" é estável dentro do request (ver estoque/page). */
function inicioDoPeriodo(dias: string): string {
  return new Date(Date.now() - (Number(dias) - 1) * 86_400_000).toISOString().slice(0, 10);
}

function qs(p: Params, troca: Partial<Params>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...p, ...troca })) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `/auditoria?${s}` : "/auditoria";
}

export default async function AuditoriaPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { me, org } = await orgSession();
  // O servidor nega de qualquer forma (403); o redirect é só cortesia de UX.
  if (org.role !== "master" && !me.platform_admin) redirect("/");

  const p = await searchParams;
  const dias = PERIODOS.some((x) => x.key === p.dias) ? p.dias! : "7";
  const desde = inicioDoPeriodo(dias);
  const api = new URLSearchParams({ desde, limite: "150" });
  if (p.usuario) api.set("usuario", p.usuario);
  if (p.sessao) api.set("sessao", p.sessao);
  if (p.antes) api.set("antes", p.antes);
  const dados = await serverApi.auditoria(org.slug, `?${api}`);

  const nomes = new Map(dados.ok ? dados.data.membros.map((m) => [m.id, m.email]) : []);
  // Linha do tempo agrupada por dia (data local de quem lê).
  const grupos = new Map<string, EventoAuditoria[]>();
  if (dados.ok) {
    for (const e of dados.data.eventos) {
      const dia = new Date(e.em).toLocaleDateString("pt-BR", {
        weekday: "long", day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo",
      });
      grupos.set(dia, [...(grupos.get(dia) ?? []), e]);
    }
  }

  return (
    <div className="viz-root min-h-screen bg-[var(--surface-0)]">
      <Header org={org.slug} orgName={org.name} role={org.role} email={me.email} lojas={org.lojas} loja={org.loja} />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">Auditoria</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            O que cada pessoa fez no painel, desde o login — inclusive o que foi enviado à VMpay.
          </p>
        </header>

        <form action="/auditoria" className="mb-5 flex flex-wrap items-end gap-3">
          <label className="text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">
            Pessoa
            <select
              name="usuario"
              defaultValue={p.usuario ?? ""}
              className="mt-1 block rounded-md border border-[var(--grid)] bg-[var(--surface-1)] px-2 py-1.5 text-base normal-case tracking-normal text-[var(--text-primary)] sm:text-sm"
            >
              <option value="">Todas</option>
              {dados.ok
                ? dados.data.membros.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.email} ({m.papel})
                    </option>
                  ))
                : null}
            </select>
          </label>
          <label className="text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">
            Período
            <select
              name="dias"
              defaultValue={dias}
              className="mt-1 block rounded-md border border-[var(--grid)] bg-[var(--surface-1)] px-2 py-1.5 text-base normal-case tracking-normal text-[var(--text-primary)] sm:text-sm"
            >
              {PERIODOS.map((x) => (
                <option key={x.key} value={x.key}>
                  {x.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-contrast)]"
          >
            Filtrar
          </button>
          {p.sessao ? (
            <Link href={qs(p, { sessao: undefined, antes: undefined })} className="text-sm text-[var(--text-secondary)] underline">
              mostrando uma sessão — ver todas
            </Link>
          ) : null}
        </form>

        {!dados.ok ? (
          <Offline error={dados.error} />
        ) : dados.data.eventos.length === 0 ? (
          <p className="rounded-md border border-dashed border-[var(--grid)] p-8 text-center text-sm text-[var(--text-secondary)]">
            Nada registrado neste período.
          </p>
        ) : (
          <div className="space-y-6">
            {[...grupos.entries()].map(([dia, eventos]) => (
              <section key={dia}>
                <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">{dia}</h2>
                <ol className="divide-y divide-[var(--grid)] rounded-xl border border-[var(--grid)] bg-[var(--surface-1)]">
                  {eventos.map((e) => {
                    const falhou = e.status === "error";
                    return (
                      <li key={`${e.fonte}-${e.id}`} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-baseline sm:gap-4">
                        <time className="shrink-0 text-xs tabular-nums text-[var(--text-secondary)] sm:w-12" dateTime={e.em}>
                          {new Date(e.em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}
                        </time>
                        <div className="min-w-0 flex-1">
                          <p className={`text-sm ${e.acao === "login" ? "font-medium" : ""} text-[var(--text-primary)]`}>
                            {descrever(e, nomes)}
                            {e.fonte === "vmpay" ? (
                              <span className={`ml-2 text-xs ${falhou ? "text-[var(--status-critical)]" : "text-[var(--text-secondary)]"}`}>
                                {falhou ? "■ VMpay recusou" : e.status === "pending" ? "▲ sem resposta da VMpay" : "● enviado à VMpay"}
                              </span>
                            ) : null}
                          </p>
                          <p className="text-xs text-[var(--text-secondary)]">
                            <Link href={qs(p, { usuario: e.usuario_id, antes: undefined })} className="hover:underline">
                              {e.usuario}
                            </Link>
                            {e.acao === "login" ? (
                              <>
                                {[aparelho(e.navegador), e.ip].filter(Boolean).length ? ` · ${[aparelho(e.navegador), e.ip].filter(Boolean).join(" · ")}` : ""}
                                {e.sessao && !p.sessao ? (
                                  <>
                                    {" · "}
                                    <Link href={qs({ dias: "90" }, { sessao: e.sessao })} className="underline">
                                      ver tudo desta sessão
                                    </Link>
                                  </>
                                ) : null}
                              </>
                            ) : null}
                            {falhou && e.erro ? ` · ${e.erro}` : ""}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </section>
            ))}
            {dados.data.proxima ? (
              <Link href={qs(p, { antes: dados.data.proxima })} className="inline-block text-sm text-[var(--text-secondary)] underline">
                Ver mais antigos
              </Link>
            ) : null}
          </div>
        )}
        <p className="mt-6 text-xs text-[var(--text-secondary)]">
          Horários de Brasília. O registro fica mesmo se a pessoa for removida da organização.
        </p>
      </main>
    </div>
  );
}
