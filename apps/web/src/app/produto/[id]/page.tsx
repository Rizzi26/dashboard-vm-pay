import { Header } from "@/components/Header";
import { Offline } from "@/components/Offline";
import { PeriodoNav } from "@/components/PeriodoNav";
import { RevenueChart } from "@/components/RevenueChart";
import { StockHistoryChart } from "@/components/StockHistoryChart";
import { Botao } from "@/components/ui/Botao";
import { Cartao } from "@/components/ui/Cartao";
import { LinhaLista, Lista } from "@/components/ui/Lista";
import { Pagina } from "@/components/ui/Pagina";
import { Selo, type TomSelo } from "@/components/ui/Selo";
import { SuperficieGrafico } from "@/components/ui/SuperficieGrafico";
import { Tile } from "@/components/ui/Tile";
import { Titulo } from "@/components/ui/Titulo";
import type { CargaProduto } from "@/lib/api";
import { serverApi } from "@/lib/api.server";
import { formatDay, formatDayTime, formatInt, formatMoney } from "@/lib/format";
import { orgSession } from "@/lib/org";
import { PERIODOS, startFor } from "@/lib/periodos";

/** O que a VMpay respondeu ao restock da carga — o status vem do action_log. */
function statusCarga(c: CargaProduto): { tom: TomSelo; texto: string } {
  if (c.vmpay.status === "success") return { tom: "verde", texto: "enviado à VMpay" };
  if (c.vmpay.status === "error" || c.status === "error") return { tom: "vermelho", texto: "falhou na VMpay" };
  if (c.vmpay.status === "pending") return { tom: "laranja", texto: "aguardando a VMpay" };
  return { tom: "cinza", texto: "sem registro" };
}

function CargasRecentes({ cargas }: { cargas: Awaited<ReturnType<typeof serverApi.cargasProduto>> }) {
  return (
    <Cartao titulo="Cargas recentes" subtitulo="O que entrou deste produto pelo pick list.">
      {!cargas.ok ? (
        <p className="m-0 text-[14px] text-sec">Não foi possível carregar as cargas ({cargas.error}).</p>
      ) : cargas.data.length === 0 ? (
        <p className="m-0 text-[14px] text-sec">Nenhuma carga deste produto pelo pick list ainda.</p>
      ) : (
        <Lista rotulo="Cargas recentes">
          {cargas.data.map((c) => {
            const s = statusCarga(c);
            const cupom = c.numero ? `NFC-e ${c.numero}` : `chave …${c.chave.slice(-6)}`;
            return (
              <LinhaLista
                key={c.receipt_id}
                href={`/picklist/cupom/${c.receipt_id}`}
                principal={`+${formatInt(c.unidades)} un. pelo cupom ${cupom}`}
                secundario={`${formatDayTime(c.carregado_em)} · ${c.loja} · aprovado por ${c.aprovado_por}`}
                direita={<Selo tom={s.tom}>{s.texto}</Selo>}
              />
            );
          })}
        </Lista>
      )}
    </Cartao>
  );
}

export default async function ProdutoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ periodo?: string }>;
}) {
  const { me, org } = await orgSession();
  const { id } = await params;
  const { periodo = "30" } = await searchParams;
  // "tudo" vira o teto do endpoint (365): a série começa no deploy do
  // histórico de qualquer jeito, então o teto nunca corta dado real.
  const diasHistorico = Number(periodo) || 365;
  // Cargas expõem quem aprovou e a resposta da VMpay: admin para cima, como
  // o pick list. Para o viewer nem se pede (a API recusaria com 403).
  const veCargas = org.role !== "viewer" || me.platform_admin;
  const [detail, historico, cargas] = await Promise.all([
    serverApi.product(org.slug, id, `?start=${startFor(periodo)}`),
    serverApi.stockHistory(org.slug, id, diasHistorico),
    veCargas ? serverApi.cargasProduto(org.slug, id) : Promise.resolve(null),
  ]);
  const rotuloPeriodo = (PERIODOS.find((p) => p.key === periodo) ?? PERIODOS[0]).label.toLowerCase();

  return (
    <div className="min-h-screen">
      <Header org={org.slug} orgName={org.name} role={org.role} email={me.email} lojas={org.lojas} loja={org.loja} periodo={periodo} />
      <Pagina>
        {detail.ok ? (
          <>
            <Titulo
              voltar={{ href: "/prateleira", rotulo: "Prateleira" }}
              sobretitulo={
                detail.data.produto.barcode
                  ? `Código de barras ${detail.data.produto.barcode}`
                  : "Sem código de barras"
              }
              titulo={detail.data.produto.nome}
              subtitulo={`${formatDay(detail.data.periodo.inicio)} a ${formatDay(detail.data.periodo.fim)}`}
              acoes={
                <Botao
                  tamanho="p"
                  href={`/prateleira?q=${encodeURIComponent(
                    detail.data.produto.barcode ?? detail.data.produto.nome,
                  )}`}
                >
                  Ver na prateleira
                </Botao>
              }
            />
            <PeriodoNav basePath={`/produto/${id}`} periodo={periodo} className="self-start" />

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
              <Tile
                rotulo={detail.data.produto.estoque === 0 ? "■ Na prateleira" : "Na prateleira"}
                valor={`${formatInt(detail.data.produto.estoque)} un.`}
                tom={detail.data.produto.estoque === 0 ? "critico" : undefined}
                dica={detail.data.produto.estoque === 0 ? "em ruptura" : undefined}
              />
              <Tile
                rotulo="Preço"
                valor={detail.data.produto.preco !== null ? formatMoney(detail.data.produto.preco) : "—"}
                dica={
                  detail.data.resumo.preco_medio !== null
                    ? `praticado: ${formatMoney(detail.data.resumo.preco_medio)}`
                    : undefined
                }
              />
              <Tile
                rotulo={`Vendidas · ${rotuloPeriodo}`}
                valor={formatInt(detail.data.resumo.unidades)}
                dica={`${formatMoney(detail.data.resumo.faturamento)} faturados`}
              />
              <Tile
                rotulo="Última venda"
                valor={
                  detail.data.resumo.ultima_venda
                    ? formatDay(detail.data.resumo.ultima_venda.slice(0, 10))
                    : "—"
                }
              />
            </div>

            <div className="grid gap-3.5 md:grid-cols-2 md:gap-4">
              <Cartao titulo="Vendas por dia" subtitulo="Unidades e faturamento deste produto, pelos /vends.">
                <SuperficieGrafico>
                  <RevenueChart
                    points={detail.data.diario.map((d) => ({
                      dia: d.dia,
                      faturamento: d.faturamento,
                      transacoes: d.unidades,
                    }))}
                    countLabel="unidades"
                  />
                </SuperficieGrafico>
              </Cartao>

              {historico.ok ? (
                <Cartao
                  titulo="Saldo na prateleira"
                  subtitulo="Cada degrau é uma leitura; subida = reposição."
                >
                  <SuperficieGrafico>
                    <StockHistoryChart points={historico.data} />
                  </SuperficieGrafico>
                </Cartao>
              ) : null}
            </div>

            {cargas ? <CargasRecentes cargas={cargas} /> : null}
          </>
        ) : (
          <>
            <Titulo voltar={{ href: "/prateleira", rotulo: "Prateleira" }} titulo="Produto" />
            <Offline error={detail.error} />
          </>
        )}
      </Pagina>
    </div>
  );
}
