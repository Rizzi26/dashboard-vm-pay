import Link from "next/link";
import { redirect } from "next/navigation";
import { Header } from "@/components/Header";
import { Offline } from "@/components/Offline";
import { PaginacaoLinks, paginaDaUrl } from "@/components/PaginacaoLinks";
import { Botao } from "@/components/ui/Botao";
import { Cartao } from "@/components/ui/Cartao";
import { CabecalhoLista, Lista } from "@/components/ui/Lista";
import { Pagina } from "@/components/ui/Pagina";
import { Segmentado } from "@/components/ui/Segmentado";
import { Selo } from "@/components/ui/Selo";
import { Titulo } from "@/components/ui/Titulo";
import type { EventoAuditoria } from "@/lib/api";
import { serverApi } from "@/lib/api.server";
import { orgSession } from "@/lib/org";

const PERIODOS = [
  { key: "1", label: "Hoje", titulo: "Hoje" },
  { key: "7", label: "7 dias", titulo: "Últimos 7 dias" },
  { key: "30", label: "30 dias", titulo: "Últimos 30 dias" },
  { key: "90", label: "90 dias", titulo: "Últimos 90 dias" },
];

type Params = { usuario?: string; sessao?: string; dias?: string; pagina?: string };

const POR_PAGINA = 50;

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
      return `Aprovou carga de cupom — ${(a.items as unknown[] | undefined)?.length ?? 0} produtos`;
    case "stock.restock":
      return `Lançou reabastecimento — ${(a.items as unknown[] | undefined)?.length ?? 0} produtos`;
    case "stock.price":
      return `Alterou preço para R$ ${texto(a.price)}`;
    case "product.create":
      return `Cadastrou o produto "${texto(a.name)}"`;
    case "estoque.exportar":
      return `Exportou a prateleira (${texto(a.linhas)} linhas)`;
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

/** Fora do componente: o "agora" é estável dentro do request (ver prateleira/page). */
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
  const pagina = paginaDaUrl(p.pagina);
  const api = new URLSearchParams({ desde, limite: String(POR_PAGINA), pagina: String(pagina) });
  if (p.usuario) api.set("usuario", p.usuario);
  if (p.sessao) api.set("sessao", p.sessao);
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

  const linkFiltro = "text-azul-texto no-underline hover:underline";

  return (
    <div className="min-h-screen">
      <Header org={org.slug} orgName={org.name} role={org.role} email={me.email} lojas={org.lojas} loja={org.loja} />
      <Pagina largura="estreita">
        <Titulo
          sobretitulo={PERIODOS.find((x) => x.key === dias)?.titulo}
          titulo="Auditoria"
          subtitulo="O que cada pessoa fez no painel desde o login, inclusive o que foi enviado à VMpay."
        />

        <div className="flex flex-col gap-2.5 md:flex-row md:flex-wrap md:items-center">
          {/* Pessoa vai por formulário (funciona sem JS); o período, por link,
              preservando a pessoa e a sessão que já estão na URL. */}
          <form action="/auditoria" className="flex items-center gap-2">
            <input type="hidden" name="dias" value={dias} />
            <select
              name="usuario"
              aria-label="Pessoa"
              defaultValue={p.usuario ?? ""}
              className="h-11 min-w-0 flex-1 rounded-xl border border-campo-borda bg-campo px-3 text-[16px] text-texto md:h-[38px] md:max-w-[22rem] md:flex-none md:text-[14px]"
            >
              <option value="">Todas as pessoas</option>
              {dados.ok
                ? dados.data.membros.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.email} ({m.papel})
                    </option>
                  ))
                : null}
            </select>
            <Botao type="submit" tamanho="p">
              Filtrar
            </Botao>
          </form>
          <div className="w-full md:w-auto">
            <Segmentado
              rotulo="Período"
              valor={dias}
              largo
              opcoes={PERIODOS.map((x) => ({
                valor: x.key,
                rotulo: x.label,
                href: qs(p, { dias: x.key, pagina: undefined }),
              }))}
            />
          </div>
          {p.sessao ? (
            <Link href={qs(p, { sessao: undefined, pagina: undefined })} className={`text-[13px] ${linkFiltro}`}>
              mostrando uma sessão — ver todas
            </Link>
          ) : null}
        </div>

        {!dados.ok ? (
          <Offline error={dados.error} />
        ) : dados.data.eventos.length === 0 ? (
          <Cartao className="text-center">
            <p className="m-0 py-4 text-[15px] text-sec">Nada registrado neste período.</p>
          </Cartao>
        ) : (
          <>
            {[...grupos.entries()].map(([dia, eventos]) => (
              <section key={dia} className="flex flex-col gap-2">
                <CabecalhoLista className="mt-2">{dia}</CabecalhoLista>
                <Lista como="ol">
                  {eventos.map((e) => {
                    const falhou = e.status === "error";
                    const sessao = [aparelho(e.navegador), e.ip].filter(Boolean);
                    return (
                      // No celular a hora sobe para cima do texto: a coluna
                      // de 48px roubaria espaço da descrição em 390px.
                      <li
                        key={`${e.fonte}-${e.id}`}
                        className="flex flex-col gap-0.5 px-4 py-[13px] md:flex-row md:gap-4 md:px-[18px]"
                      >
                        <time
                          className="shrink-0 text-[13px] tabular-nums text-sec md:w-12 md:pt-0.5"
                          dateTime={e.em}
                        >
                          {new Date(e.em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })}
                        </time>
                        <div className="min-w-0 flex-1">
                          <p className={`m-0 break-words text-[16px] text-texto md:text-[15px] ${e.acao === "login" ? "font-semibold" : ""}`}>
                            {descrever(e, nomes)}
                            {e.fonte === "vmpay" ? (
                              <>
                                {" "}
                                {falhou ? (
                                  <Selo tom="vermelho">VMpay recusou</Selo>
                                ) : e.status === "pending" ? (
                                  <Selo tom="laranja">sem resposta da VMpay</Selo>
                                ) : (
                                  <Selo tom="verde">enviado à VMpay</Selo>
                                )}
                              </>
                            ) : null}
                          </p>
                          <p className="m-0 break-words text-[13px] text-sec">
                            <Link href={qs(p, { usuario: e.usuario_id, pagina: undefined })} className={linkFiltro}>
                              {e.usuario}
                            </Link>
                            {e.acao === "login" ? (
                              <>
                                {sessao.length ? ` · ${sessao.join(" · ")}` : ""}
                                {e.sessao && !p.sessao ? (
                                  <>
                                    {" · "}
                                    <Link href={qs({ dias: "90" }, { sessao: e.sessao })} className={linkFiltro}>
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
                </Lista>
              </section>
            ))}
            <PaginacaoLinks
              pagina={pagina}
              total={dados.data.total}
              porPagina={POR_PAGINA}
              href={(n) => qs(p, { pagina: String(n) })}
              rotulo="eventos"
            />
          </>
        )}
        <p className="m-0 px-1 text-[13px] text-sec">
          Horários de Brasília. O registro fica mesmo se a pessoa for removida da organização.
        </p>
      </Pagina>
    </div>
  );
}
