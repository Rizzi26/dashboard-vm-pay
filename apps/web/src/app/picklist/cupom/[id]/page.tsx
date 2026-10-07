import Link from "next/link";
import { redirect } from "next/navigation";
import { Header } from "@/components/Header";
import { Offline } from "@/components/Offline";
import { PaginacaoLinks, paginaDaUrl } from "@/components/PaginacaoLinks";
import { LinhaLista, Lista } from "@/components/ui/Lista";
import { Pagina } from "@/components/ui/Pagina";
import { Selo } from "@/components/ui/Selo";
import type { TomSelo } from "@/components/ui/Selo";
import { Titulo } from "@/components/ui/Titulo";
import { serverApi } from "@/lib/api.server";
import { formatDayTime, formatInt, formatMoney } from "@/lib/format";
import { orgSession } from "@/lib/org";

const STATUS: Record<string, { rotulo: string; tom: TomSelo }> = {
  approved: { rotulo: "carregado", tom: "verde" },
  error: { rotulo: "recusado pela VMpay", tom: "vermelho" },
  pending: { rotulo: "em andamento", tom: "laranja" },
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
  const voltar = { href: "/picklist", rotulo: "Pick list" };
  // Carga manual: sem chave nem NFC-e — o título é o fornecedor digitado.
  const avulsa = cupom.ok && cupom.data.origem === "avulsa";

  return (
    <div className="min-h-screen">
      <Header org={org.slug} orgName={org.name} role={org.role} email={me.email} lojas={org.lojas} loja={org.loja} />
      <Pagina>
        {!cupom.ok ? (
          <>
            <Titulo voltar={voltar} titulo="Cupom" />
            <Offline error={cupom.error} />
          </>
        ) : (
          <>
            <Titulo
              voltar={voltar}
              sobretitulo={[
                cupom.data.numero ? `NFC-e ${cupom.data.numero}` : null,
                cupom.data.valor_total !== null ? formatMoney(cupom.data.valor_total) : null,
                cupom.data.loja,
              ]
                .filter(Boolean)
                .join(" · ")}
              titulo={
                avulsa
                  ? `Carga manual · ${cupom.data.fornecedor.nome || "sem fornecedor"}`
                  : cupom.data.fornecedor.nome || "Fornecedor"
              }
              subtitulo={`${avulsa ? "Lançada" : "Carregado"} em ${formatDayTime(cupom.data.carregado_em)} por ${cupom.data.aprovado_por}`}
              acoes={
                <>
                  {avulsa ? (
                    <Selo tom="cinza" simbolo={null}>
                      manual
                    </Selo>
                  ) : null}
                  <Selo tom={STATUS[cupom.data.status]?.tom ?? "cinza"}>
                    {STATUS[cupom.data.status]?.rotulo ?? cupom.data.status}
                  </Selo>
                </>
              }
            />
            {cupom.data.vmpay.erro ? (
              <div
                role="alert"
                className="flex gap-2 rounded-2xl border border-vermelho-borda bg-vermelho-fundo px-4 py-3 text-[14px] text-texto"
              >
                <span aria-hidden="true" className="text-vermelho-texto">
                  ■
                </span>
                <span className="min-w-0">A VMpay respondeu: {cupom.data.vmpay.erro}</span>
              </div>
            ) : null}

            <Lista rotulo={avulsa ? "Itens da carga" : "Itens do cupom"}>
              {cupom.data.itens.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA).map((i) => (
                <LinhaLista
                  key={i.linha}
                  className={i.ignorado ? "opacity-45" : ""}
                  principal={
                    <>
                      {i.descricao}
                      {i.codigo ? <span className="ml-2 whitespace-nowrap text-xs text-sec">cód. {i.codigo}</span> : null}
                    </>
                  }
                  secundario={
                    i.ignorado ? (
                      "ignorado — não entrou na prateleira"
                    ) : i.produto ? (
                      <>
                        →{" "}
                        <Link href={`/produto/${i.produto.id}`} className="text-azul-texto no-underline hover:underline">
                          {i.produto.nome}
                        </Link>
                      </>
                    ) : (
                      "sem produto"
                    )
                  }
                  direita={
                    <span className="tabular-nums">
                      <span className="block text-[15px] font-semibold text-texto">
                        {i.entrou !== null ? `+${formatInt(i.entrou)} un.` : "—"}
                      </span>
                      <span className="block text-xs text-sec">
                        {i.quantidade !== null ? `${formatInt(i.quantidade)} ${i.unidade ?? ""}` : ""}
                        {i.fator && i.fator !== 1 ? ` × ${formatInt(i.fator)}` : ""}
                        {i.valor_total !== null ? ` · ${formatMoney(i.valor_total)}` : ""}
                      </span>
                    </span>
                  }
                />
              ))}
            </Lista>
            <PaginacaoLinks
              pagina={pagina}
              total={cupom.data.itens.length}
              porPagina={POR_PAGINA}
              href={(n) => `/picklist/cupom/${id}?pagina=${n}`}
              rotulo="linhas"
            />
            {cupom.data.chave ? (
              <p className="m-0 break-all text-xs text-sec">Chave de acesso {cupom.data.chave}</p>
            ) : (
              <p className="m-0 text-xs text-sec">Montada à mão no pick list, sem cupom fiscal lido.</p>
            )}
          </>
        )}
      </Pagina>
    </div>
  );
}
