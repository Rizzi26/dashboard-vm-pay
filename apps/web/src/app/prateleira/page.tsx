import { Header } from "@/components/Header";
import { Offline } from "@/components/Offline";
import { StockView } from "@/components/StockView";
import { Pagina } from "@/components/ui/Pagina";
import { Titulo } from "@/components/ui/Titulo";
import { serverApi } from "@/lib/api.server";
import { formatAtraso } from "@/lib/format";
import { orgSession } from "@/lib/org";

/**
 * Frescor do dado: o operador decide reposição sobre este saldo — se ele
 * está velho, precisa saber antes de sair carregando caixa. Fora do corpo do
 * componente porque numa página dinâmica de servidor cada request é um render
 * novo — o "agora" é estável dentro do request.
 */
function atrasoDoEstoque(rows: { atualizado_em: string }[]): number | null {
  if (rows.length === 0) return null;
  const maisRecente = Math.max(...rows.map((r) => Date.parse(r.atualizado_em)));
  if (Number.isNaN(maisRecente)) return null;
  return Math.max(0, Math.floor((Date.now() - maisRecente) / 1000));
}

export default async function PrateleiraPage({
  searchParams,
}: {
  searchParams: Promise<{ disp?: string; q?: string }>;
}) {
  const { me, org } = await orgSession();
  const { disp, q } = await searchParams;
  const initialDisp = disp === "com" || disp === "sem" ? disp : undefined;
  const todos = await serverApi.stock(org.slug);
  // Loja escolhida na barra: só os saldos dela.
  const stock = todos.ok && org.loja
    ? { ...todos, data: todos.data.filter((r) => r.location_id === org.loja) }
    : todos;

  const atrasoSeg = stock.ok ? atrasoDoEstoque(stock.data) : null;

  // "Lida há X": o operador decide reposição sobre este saldo; velho demais
  // (mais de 9 h, o dobro do pior intervalo do cron) vira alerta laranja.
  const sobretitulo =
    atrasoSeg === null ? undefined : atrasoSeg > 9 * 3600 ? (
      <span className="text-laranja-texto">▲ Lida {formatAtraso(atrasoSeg)}</span>
    ) : (
      <>Lida {formatAtraso(atrasoSeg)}</>
    );

  return (
    <div className="min-h-screen">
      <Header org={org.slug} orgName={org.name} role={org.role} email={me.email} lojas={org.lojas} loja={org.loja} />
      <Pagina>
        {stock.ok ? (
          <StockView
            rows={stock.data}
            org={org.slug}
            role={org.role}
            initialDisp={initialDisp}
            initialBusca={q}
            loja={org.loja}
            outrasLojas={org.loja && todos.ok ? todos.data.filter((r) => r.location_id !== org.loja) : []}
            sobretitulo={sobretitulo}
          />
        ) : (
          <>
            <Titulo titulo="Prateleira" subtitulo="O que está exposto em cada loja agora." />
            <Offline error={stock.error} />
          </>
        )}
      </Pagina>
    </div>
  );
}
