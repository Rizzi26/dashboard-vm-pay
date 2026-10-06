import Link from "next/link";
import { redirect } from "next/navigation";
import { Header } from "@/components/Header";
import { Offline } from "@/components/Offline";
import { PaginacaoLinks, paginaDaUrl } from "@/components/PaginacaoLinks";
import { serverApi } from "@/lib/api.server";
import { formatDayTime, formatInt, formatMoney } from "@/lib/format";
import { orgSession } from "@/lib/org";

const STATUS: Record<string, string> = {
  approved: "carregado",
  error: "recusado pela VMpay",
  pending: "em andamento",
};

/** Um cupom carregado: o que entrou em cada produto, quem aprovou e o que a VMpay respondeu. */
const POR_PAGINA = 20;

export default async function CupomPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ pagina?: string }>;
}) {
  const { me, org } = await orgSession();
  if (org.role === "viewer" && !me.platform_admin) redirect("/");
  const { id } = await params;
  const pagina = paginaDaUrl((await searchParams).pagina);
  const cupom = await serverApi.picklistCupom(org.slug, id);

  return (
    <div className="viz-root min-h-screen bg-[var(--surface-0)]">
      <Header org={org.slug} orgName={org.name} role={org.role} email={me.email} lojas={org.lojas} loja={org.loja} />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
        <Link href="/picklist" className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
          ← Pick list
        </Link>
        {!cupom.ok ? (
          <div className="mt-4">
            <Offline error={cupom.error} />
          </div>
        ) : (
          <>
            <header className="mb-6 mt-3">
              <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
                {cupom.data.fornecedor.nome || "Fornecedor"}
              </h1>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">
                {cupom.data.numero ? `NFC-e ${cupom.data.numero} · ` : ""}
                {cupom.data.valor_total !== null ? `${formatMoney(cupom.data.valor_total)} · ` : ""}
                {cupom.data.loja}
              </p>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">
                Carregado em {formatDayTime(cupom.data.carregado_em)} por {cupom.data.aprovado_por}
                {" · "}
                <span className={cupom.data.status === "approved" ? "" : "text-[var(--status-warning)]"}>
                  {STATUS[cupom.data.status] ?? cupom.data.status}
                </span>
                {cupom.data.vmpay.erro ? (
                  <span className="text-[var(--status-critical)]"> — {cupom.data.vmpay.erro}</span>
                ) : null}
              </p>
            </header>

            <ul className="divide-y divide-[var(--grid)] rounded-xl border border-[var(--grid)] bg-[var(--surface-1)]">
              {cupom.data.itens.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA).map((i) => (
                <li key={i.linha} className={`flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 ${i.ignorado ? "opacity-50" : ""}`}>
                  <div className="min-w-0">
                    <p className="text-sm text-[var(--text-primary)]">
                      {i.descricao}
                      {i.codigo ? <span className="ml-2 text-xs text-[var(--text-secondary)]">cód. {i.codigo}</span> : null}
                    </p>
                    <p className="text-xs text-[var(--text-secondary)]">
                      {i.ignorado ? (
                        "ignorado — não entrou na prateleira"
                      ) : i.produto ? (
                        <>
                          →{" "}
                          <Link href={`/produto/${i.produto.id}`} className="hover:underline">
                            {i.produto.nome}
                          </Link>
                        </>
                      ) : (
                        "sem produto"
                      )}
                    </p>
                  </div>
                  <p className="shrink-0 text-right text-sm tabular-nums text-[var(--text-primary)]">
                    {i.entrou !== null ? `+${formatInt(i.entrou)} un.` : "—"}
                    <span className="block text-xs text-[var(--text-secondary)]">
                      {i.quantidade !== null ? `${formatInt(i.quantidade)} ${i.unidade ?? ""}` : ""}
                      {i.fator && i.fator !== 1 ? ` × ${formatInt(i.fator)}` : ""}
                      {i.valor_total !== null ? ` · ${formatMoney(i.valor_total)}` : ""}
                    </span>
                  </p>
                </li>
              ))}
            </ul>
            <PaginacaoLinks
              pagina={pagina}
              total={cupom.data.itens.length}
              porPagina={POR_PAGINA}
              href={(n) => `/picklist/cupom/${id}?pagina=${n}`}
              rotulo="linhas"
            />
            <p className="mt-4 text-xs text-[var(--text-secondary)]">Chave de acesso {cupom.data.chave}</p>
          </>
        )}
      </main>
    </div>
  );
}
