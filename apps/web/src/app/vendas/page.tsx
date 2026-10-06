import { MachineTable } from "@/components/MachineTable";
import { Offline } from "@/components/Offline";
import { PeriodoNav } from "@/components/PeriodoNav";
import { RevenueChart } from "@/components/RevenueChart";
import { SyncStatus } from "@/components/SyncStatus";

import { CurvaAbc } from "@/components/CurvaAbc";
import { Header } from "@/components/Header";
import { VendasHeatmap } from "@/components/VendasHeatmap";
import { Cartao } from "@/components/ui/Cartao";
import { Pagina } from "@/components/ui/Pagina";
import { SuperficieGrafico } from "@/components/ui/SuperficieGrafico";
import { Tile } from "@/components/ui/Tile";
import { Titulo } from "@/components/ui/Titulo";
import { serverApi } from "@/lib/api.server";
import { formatDay, formatInt, formatMoney } from "@/lib/format";
import { lojaQs, orgSession } from "@/lib/org";
import { startFor } from "@/lib/periodos";

/**
 * "▲ +12% vs anterior" — ou nada, quando não há base para comparar. Queda em
 * laranja, não vermelho: é sinal para olhar, não falha. O símbolo vai junto
 * para a direção não depender só da cor.
 */
function variacao(atual: number, antes: number | undefined) {
  if (antes === undefined || antes <= 0) return null;
  const v = ((atual - antes) / antes) * 100;
  const n = Math.abs(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 });
  // Arredondado a zero conta como estável, senão "▲ +0%" aparece em verde.
  if (n === "0") return <span className="font-medium text-sec">± 0% vs anterior</span>;
  return v > 0 ? (
    <span className="font-medium text-verde-texto">▲ +{n}% vs anterior</span>
  ) : (
    <span className="font-medium text-laranja-texto">▼ −{n}% vs anterior</span>
  );
}

export default async function VendasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { me, org } = await orgSession();
  const params = await searchParams;
  const periodo = typeof params.periodo === "string" ? params.periodo : "30";
  const qs = `?start=${startFor(periodo)}${lojaQs(org.loja)}`;

  // Em paralelo: um bloco lento não segura os outros, e um que falha não
  // derruba a página.
  const [summary, daily, machines, sync, heat, abc] = await Promise.all([
    serverApi.summary(org.slug, qs),
    serverApi.daily(org.slug, qs),
    serverApi.byMachine(org.slug, `${qs}&limit=10`),
    serverApi.syncStatus(org.slug),
    serverApi.heatmap(org.slug, qs),
    serverApi.abc(org.slug, qs),
  ]);
  // "Tudo" não tem período anterior que faça sentido.
  const anterior = periodo !== "tudo" && summary.ok ? summary.data.anterior : undefined;
  const s = summary.ok ? summary.data : null;

  const subtituloAbc =
    abc.ok && abc.data.itens.length > 0
      ? `${formatInt(abc.data.resumo.A.produtos)} de ${formatInt(abc.data.itens.length)} produtos vendidos fazem 80% do faturamento.`
      : "Produtos por faturamento no período: A faz 80%, B os 15% seguintes, C o resto.";

  return (
    <div className="min-h-screen">
      <Header org={org.slug} orgName={org.name} role={org.role} email={me.email} lojas={org.lojas} loja={org.loja} periodo={periodo} />
      <Pagina>
        <Titulo
          sobretitulo={s ? `${formatDay(s.periodo.inicio)} a ${formatDay(s.periodo.fim)}` : "Últimos 30 dias"}
          titulo="Vendas"
          subtitulo={org.loja ? org.local : undefined}
          // No celular o período desce para a largura toda (abaixo).
          acoes={
            <div className="hidden md:block">
              <PeriodoNav basePath="/vendas" periodo={periodo} params={params} />
            </div>
          }
        />
        <div className="md:hidden">
          <PeriodoNav basePath="/vendas" periodo={periodo} params={params} largo />
        </div>

        {s ? (
          <div className="grid grid-cols-2 gap-2.5 md:gap-4 lg:grid-cols-4">
            <Tile
              rotulo="Faturamento"
              valor={formatMoney(s.faturamento)}
              dica={
                variacao(s.faturamento, anterior?.faturamento) ??
                (s.descontos > 0 ? `descontos de ${formatMoney(s.descontos)}` : "transações confirmadas")
              }
            />
            <Tile
              rotulo="Transações"
              valor={formatInt(s.transacoes)}
              dica={variacao(s.transacoes, anterior?.transacoes) ?? `${formatInt(s.itens)} itens vendidos`}
            />
            <Tile
              rotulo="Ticket médio"
              valor={formatMoney(s.ticket_medio)}
              dica={variacao(s.ticket_medio, anterior?.ticket_medio)}
            />
            <Tile rotulo="Máquinas ativas" valor={formatInt(s.maquinas_ativas)} />
          </div>
        ) : summary.ok ? null : (
          <Offline error={summary.error} />
        )}

        <Cartao
          titulo="Faturamento por dia"
          subtitulo="Só transações com status OK — canceladas não entram."
        >
          <SuperficieGrafico>
            {daily.ok ? <RevenueChart points={daily.data} /> : <Offline error={daily.error} />}
          </SuperficieGrafico>
        </Cartao>

        <div className="grid items-start gap-3.5 md:gap-4 lg:grid-cols-2">
          <Cartao
            titulo="Quando a loja vende"
            subtitulo="Dia da semana × hora, horário de Brasília — bom para escolher a hora da reposição."
          >
            <SuperficieGrafico>
              {heat.ok ? <VendasHeatmap celulas={heat.data.celulas} /> : <Offline error={heat.error} />}
            </SuperficieGrafico>
          </Cartao>

          <Cartao titulo="Curva ABC" subtitulo={subtituloAbc}>
            {abc.ok ? <CurvaAbc dados={abc.data} /> : <Offline error={abc.error} />}
          </Cartao>
        </div>

        <Cartao titulo="Máquinas" subtitulo="Top 10 por faturamento no período">
          {machines.ok ? <MachineTable rows={machines.data} /> : <Offline error={machines.error} />}
        </Cartao>

        <footer className="mt-2 border-t border-sep pt-4">
          {sync.ok ? (
            <SyncStatus rows={sync.data} />
          ) : (
            <p className="text-xs text-sec">Sem informação de sincronização — {sync.error}</p>
          )}
        </footer>
      </Pagina>
    </div>
  );
}
