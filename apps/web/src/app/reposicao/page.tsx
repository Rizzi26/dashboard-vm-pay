import Link from "next/link";

import { ExportCsvButton } from "@/components/ExportCsvButton";
import { Header } from "@/components/Header";
import { Offline } from "@/components/Offline";
import { serverApi } from "@/lib/api.server";
import type { ReposicaoItem } from "@/lib/api";
import { formatInt } from "@/lib/format";
import { orgSession } from "@/lib/org";

/**
 * Lista de compra do repositor, em duas seções: Zerados e Acabando. A seção
 * já diz a situação, então cada linha carrega só o que decide — o insight em
 * linguagem corrida ("vendia ~2 por semana", "restam 2 — dá para ~3 dias") e
 * o número a levar. Análise mora na ficha do produto.
 */

function ritmo(porDia: number): string {
  if (porDia >= 1) {
    const n = porDia.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
    return `~${n} por dia`;
  }
  return `~${Math.max(1, Math.round(porDia * 7))} por semana`;
}

function Linha({ item, detalhe }: { item: ReposicaoItem; detalhe: string }) {
  return (
    <li className="flex items-center justify-between gap-4 border-t border-[var(--grid)] py-3 first:border-t-0">
      <div className="min-w-0">
        <Link
          href={`/produto/${item.product_id}`}
          className="text-sm text-[var(--text-primary)] underline decoration-[var(--grid)] underline-offset-4 hover:decoration-[var(--accent)]"
        >
          {item.produto}
        </Link>
        <span className="mt-0.5 block text-xs text-[var(--text-secondary)]">{detalhe}</span>
      </div>
      <span className="shrink-0 text-lg font-semibold tabular-nums text-[var(--text-primary)]">
        {formatInt(item.sugestao)}{" "}
        <span className="text-xs font-normal text-[var(--text-secondary)]">un.</span>
      </span>
    </li>
  );
}

function Secao({
  titulo,
  subtitulo,
  tom,
  children,
}: {
  titulo: string;
  subtitulo: string;
  tom: "critical" | "warning";
  children: React.ReactNode;
}) {
  const cor =
    tom === "critical" ? "text-[var(--status-critical)]" : "text-[var(--status-warning)]";
  return (
    <section className="mb-6 rounded-xl border border-[var(--grid)] bg-[var(--surface-1)] p-4 shadow-[var(--shadow-card)] sm:p-5">
      <h2 className={`text-sm font-semibold ${cor}`}>{titulo}</h2>
      <p className="mb-2 mt-0.5 text-xs text-[var(--text-secondary)]">{subtitulo}</p>
      <ul>{children}</ul>
    </section>
  );
}

export default async function ReposicaoPage() {
  const { me, org } = await orgSession();
  const reposicao = await serverApi.reposicao(org.slug);

  const zerados = reposicao.ok
    ? reposicao.data.itens.filter((i) => i.status === "ruptura")
    : [];
  const acabando = reposicao.ok
    ? reposicao.data.itens.filter((i) => i.status === "acabando")
    : [];

  return (
    <div className="viz-root min-h-screen bg-[var(--surface-0)]">
      <Header orgName={org.name} role={org.role} email={me.email} local={org.local} />
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
              Reposição
            </h1>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              O que levar na próxima visita. A quantidade cobre uma semana de
              venda no ritmo atual.
            </p>
          </div>
          {reposicao.ok && reposicao.data.itens.length > 0 ? (
            <ExportCsvButton
              path={`/orgs/${org.slug}/stock/reposicao/export.csv`}
              filename="reposicao.csv"
            />
          ) : null}
        </header>

        {reposicao.ok ? (
          reposicao.data.itens.length === 0 ? (
            <p className="rounded-md border border-dashed border-[var(--grid)] p-8 text-center text-sm text-[var(--text-secondary)]">
              Nada para repor: nenhum produto com venda recente está zerado ou
              acabando.
            </p>
          ) : (
            <>
              {zerados.length > 0 ? (
                <Secao
                  titulo={`Zerados · ${formatInt(zerados.length)}`}
                  subtitulo="Vendiam e acabaram — cada dia sem repor é venda perdida."
                  tom="critical"
                >
                  {zerados.map((i) => (
                    <Linha
                      key={`${i.location_id}-${i.product_id}`}
                      item={i}
                      detalhe={`vendia ${ritmo(i.por_dia)}`}
                    />
                  ))}
                </Secao>
              ) : null}

              {acabando.length > 0 ? (
                <Secao
                  titulo={`Acabando · ${formatInt(acabando.length)}`}
                  subtitulo="O saldo atual dura menos de 5 dias."
                  tom="warning"
                >
                  {acabando.map((i) => (
                    <Linha
                      key={`${i.location_id}-${i.product_id}`}
                      item={i}
                      detalhe={`restam ${formatInt(i.quantidade)} — dá para ~${formatInt(
                        i.dias_restantes,
                      )} ${i.dias_restantes === 1 ? "dia" : "dias"} · vende ${ritmo(i.por_dia)}`}
                    />
                  ))}
                </Secao>
              ) : null}
            </>
          )
        ) : (
          <Offline error={reposicao.error} />
        )}
      </main>
    </div>
  );
}
