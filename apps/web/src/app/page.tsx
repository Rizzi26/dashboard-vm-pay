import type { ReactNode } from "react";
import { CartaoAdicionarLoja, ContasVmpay } from "@/components/ContasVmpay";
import { Header } from "@/components/Header";
import { BotaoReporHoje, LojaCards, LojaLista } from "@/components/LojaCards";
import { Offline } from "@/components/Offline";
import { Pagina } from "@/components/ui/Pagina";
import { Tile } from "@/components/ui/Tile";
import { Titulo } from "@/components/ui/Titulo";
import { IconeAlerta, IconeDinheiro, IconeLinhas } from "@/components/ui/icones";
import type { Central, Summary } from "@/lib/api";
import { serverApi } from "@/lib/api.server";
import { formatInt, formatMoney } from "@/lib/format";
import { orgSession } from "@/lib/org";
import { startFor } from "@/lib/periodos";

// Fuso fixo: o servidor renderiza em UTC, e às 22h de Brasília já seria amanhã.
const hojeExtenso = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "America/Sao_Paulo",
});

/** "▲ 12% vs período anterior" — ou nada, quando não há base para comparar. */
function Variacao({ atual, antes }: { atual: number; antes: number | undefined }) {
  if (!antes) return null;
  const v = ((atual - antes) / antes) * 100;
  const pct = `${Math.abs(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%`;
  return v >= 0 ? (
    <span className="font-medium text-verde-texto">▲ +{pct} vs período anterior</span>
  ) : (
    <span className="font-medium text-vermelho-texto">▼ −{pct} vs período anterior</span>
  );
}

/**
 * Central das lojas: a primeira tela. O lojista é a organização; cada
 * mercadinho dele é uma loja. Daqui se vê qual loja pede atenção e se entra
 * nela — a loja escolhida passa a valer em Vendas, Prateleira e Reposição.
 */
export default async function CentralPage() {
  const { me, org } = await orgSession();
  const ehMaster = org.role === "master" || me.platform_admin;
  // Contas só para master: é ele quem conecta loja nova (o servidor nega a quem não for).
  // O resumo vai sem loja de propósito: a Central é sempre "todas as lojas",
  // e é dele que sai a comparação com os 30 dias anteriores.
  const [central, contas, resumo] = await Promise.all([
    serverApi.lojas(org.slug),
    ehMaster ? serverApi.contas(org.slug) : Promise.resolve(null),
    serverApi.summary(org.slug, `?start=${startFor("30")}`),
  ]);

  // Nome da loja → conta VMpay de onde ela vem, para o subtítulo do cartão.
  const contaDe: Record<string, string> = {};
  if (contas?.ok) {
    for (const c of contas.data) {
      for (const nome of c.lojas) contaDe[nome] = c.principal ? "Conta principal" : `Conta ${c.nome}`;
    }
  }
  const adicionar = ehMaster ? <CartaoAdicionarLoja org={org.slug} /> : null;

  return (
    <div className="min-h-screen">
      <Header org={org.slug} orgName={org.name} role={org.role} email={me.email} lojas={org.lojas} loja={org.loja} />
      <Pagina>
        <Titulo sobretitulo={hojeExtenso.format(new Date())} titulo="Central das lojas" />

        {!central.ok ? (
          <Offline error={central.error} />
        ) : central.data.lojas.length === 0 ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <p className="vidro m-0 rounded-[22px] p-8 text-center text-[15px] text-sec">
              Nenhuma loja ainda. Cada máquina instalada na VMpay vira uma loja aqui — ela
              aparece na próxima atualização dos dados.
            </p>
            {adicionar}
          </div>
        ) : (
          <Conteudo central={central.data} resumo={resumo.ok ? resumo.data : null} contaDe={contaDe} adicionar={adicionar} />
        )}

        {contas?.ok ? <ContasVmpay org={org.slug} contas={contas.data} /> : null}
      </Pagina>
    </div>
  );
}

function Conteudo({
  central,
  resumo,
  contaDe,
  adicionar,
}: {
  central: Central;
  resumo: Summary | null;
  contaDe: Record<string, string>;
  adicionar: ReactNode;
}) {
  const { lojas, totais } = central;
  // Totais de transações saem dos cartões (a API soma só o dinheiro): mesma
  // janela de 30 dias, então o ticket fecha com o faturamento do tile.
  const transacoes = lojas.reduce((s, l) => s + l.vendas.transacoes_30d, 0);
  const ticket = transacoes ? totais.d30 / transacoes : 0;

  return (
    <>
      {/* Computador: tiles de resumo e cartões. */}
      <div className="hidden grid-cols-3 gap-4 md:grid">
        <Tile
          rotulo="Faturamento · 30 dias"
          valor={formatMoney(totais.d30)}
          dica={resumo ? <Variacao atual={resumo.faturamento} antes={resumo.anterior?.faturamento} /> : undefined}
          icone={<IconeDinheiro tamanho={14} espessura={2.4} />}
          corIcone="azul"
        />
        <Tile
          rotulo="Transações"
          valor={formatInt(transacoes)}
          dica={`ticket médio ${formatMoney(ticket)}`}
          icone={<IconeLinhas tamanho={14} espessura={2.4} />}
          corIcone="roxo"
        />
        <Tile
          rotulo="Itens zerados"
          valor={formatInt(totais.zerados)}
          dica={`${formatInt(totais.acabando)} acabando`}
          icone={<IconeAlerta tamanho={14} espessura={2.4} />}
          corIcone="laranja"
          tom={totais.zerados > 0 ? "alerta" : undefined}
        />
      </div>

      <h2 className="m-0 mt-5 hidden text-[22px] font-bold tracking-[-0.015em] text-texto md:block">Lojas</h2>

      <div className="hidden md:block">
        <LojaCards lojas={lojas} contaDe={contaDe} extra={adicionar} />
      </div>

      {/* Celular: o dia de todas as lojas, a lista e o atalho da reposição. */}
      <div className="flex flex-col gap-3.5 md:hidden">
        <div className="vidro rounded-[20px] p-[18px]">
          <div className="text-[13px] text-sec">Hoje · todas as lojas</div>
          <div className="mt-1 break-words text-[34px] font-bold tracking-[-0.02em] tabular-nums text-texto">
            {formatMoney(totais.hoje)}
          </div>
          <div className="mt-2.5 flex flex-wrap gap-x-[18px] gap-y-1 text-[13px] text-sec">
            <span>
              7 dias <strong className="tabular-nums text-texto">{formatMoney(totais.d7)}</strong>
            </span>
            <span>
              30 dias <strong className="tabular-nums text-texto">{formatMoney(totais.d30)}</strong>
            </span>
          </div>
        </div>
        <h2 className="m-0 mt-1.5 text-[20px] font-bold text-texto">Lojas</h2>
        <LojaLista lojas={lojas} />
        <BotaoReporHoje />
      </div>
    </>
  );
}
