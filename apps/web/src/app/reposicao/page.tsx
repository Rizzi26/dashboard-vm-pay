import { ExportCsvButton } from "@/components/ExportCsvButton";
import { Header } from "@/components/Header";
import { PaginacaoLinks, paginaDaUrl } from "@/components/PaginacaoLinks";
import { Offline } from "@/components/Offline";
import { ReposicaoCelular } from "@/components/ReposicaoCelular";
import {
  detalheItem,
  insightReposicao,
  POR_PAGINA_REPOSICAO as POR_PAGINA,
} from "@/components/reposicao-texto";
import { Botao } from "@/components/ui/Botao";
import { Cartao } from "@/components/ui/Cartao";
import { LinhaLista, Lista } from "@/components/ui/Lista";
import { Pagina } from "@/components/ui/Pagina";
import { Selo } from "@/components/ui/Selo";
import { Titulo } from "@/components/ui/Titulo";
import { serverApi } from "@/lib/api.server";
import type { ReposicaoItem } from "@/lib/api";
import { formatInt } from "@/lib/format";
import { orgSession } from "@/lib/org";

/**
 * Lista de compra do repositor, em duas seções: Zerados e Acabando. A seção
 * já diz a situação, então cada linha carrega só o que decide — o insight em
 * linguagem corrida ("vendia ~2 por semana", "restam 2 — dá para ~3 dias") e
 * o número a levar. Análise mora na ficha do produto.
 *
 * Computador e celular são duas montagens do mesmo dado: no computador as
 * seções lado a lado, paginadas pela URL; no celular a lista de "já peguei",
 * que precisa de estado no aparelho (ReposicaoCelular).
 */

function Secao({
  titulo,
  subtitulo,
  tom,
  itens,
  comLoja,
  rodape,
}: {
  titulo: string;
  subtitulo: string;
  tom: "vermelho" | "laranja";
  itens: ReposicaoItem[];
  comLoja: boolean;
  rodape: React.ReactNode;
}) {
  const cor = tom === "vermelho" ? "text-vermelho-texto" : "text-laranja-texto";
  return (
    <Cartao titulo={<span className={`font-bold ${cor}`}>{titulo}</span>} subtitulo={subtitulo}>
      <Lista rotulo={titulo}>
        {itens.map((i) => (
          <LinhaLista
            key={`${i.location_id}-${i.product_id}`}
            href={`/produto/${i.product_id}`}
            principal={i.produto}
            secundario={detalheItem(i, false, comLoja)}
            direita={<Selo tom={tom}>levar {formatInt(i.sugestao)}</Selo>}
          />
        ))}
      </Lista>
      {rodape}
    </Cartao>
  );
}

export default async function ReposicaoPage({
  searchParams,
}: {
  searchParams: Promise<{ pz?: string; pa?: string }>;
}) {
  const { me, org } = await orgSession();
  // Uma página por seção, na URL: pz = zerados, pa = acabando.
  const sp = await searchParams;
  const pz = paginaDaUrl(sp.pz);
  const pa = paginaDaUrl(sp.pa);
  const link = (chave: "pz" | "pa", n: number) => {
    const q = new URLSearchParams({ ...(sp.pz ? { pz: sp.pz } : {}), ...(sp.pa ? { pa: sp.pa } : {}), [chave]: String(n) });
    return `/reposicao?${q}`;
  };
  const fatia = <T,>(itens: T[], pagina: number) => {
    const ultima = Math.max(1, Math.ceil(itens.length / POR_PAGINA));
    const p = Math.min(pagina, ultima);
    return itens.slice((p - 1) * POR_PAGINA, p * POR_PAGINA);
  };
  const bruto = await serverApi.reposicao(org.slug);
  // Loja escolhida na barra: a lista vale só para ela.
  const reposicao = bruto.ok && org.loja
    ? { ...bruto, data: { ...bruto.data, itens: bruto.data.itens.filter((i) => i.location_id === org.loja) } }
    : bruto;

  const zerados = reposicao.ok
    ? reposicao.data.itens.filter((i) => i.status === "ruptura")
    : [];
  const acabando = reposicao.ok
    ? reposicao.data.itens.filter((i) => i.status === "acabando")
    : [];
  const temItens = zerados.length + acabando.length > 0;
  // O pick list é de admin para cima (a página dele redireciona o viewer).
  const podePickList = org.role !== "viewer" || me.platform_admin;
  // "Todas as lojas" com mais de uma: o mesmo produto aparece por loja.
  const comLoja = !org.loja && org.lojas.length > 1;

  return (
    <div className="min-h-screen">
      <Header org={org.slug} orgName={org.name} role={org.role} email={me.email} lojas={org.lojas} loja={org.loja} />
      <Pagina>
        <Titulo
          sobretitulo={<span className="hidden md:inline">Próxima visita</span>}
          titulo="Reposição"
          subtitulo={
            <span className="hidden md:inline">
              O que levar. A quantidade cobre uma semana de venda no ritmo atual.
            </span>
          }
          acoes={
            <>
              {temItens ? (
                <ExportCsvButton
                  path={`/orgs/${org.slug}/stock/reposicao/export.csv`}
                  filename="reposicao.csv"
                  tamanho="p"
                  rotulo={
                    <>
                      <span className="md:hidden">CSV</span>
                      <span className="hidden md:inline">Exportar CSV</span>
                    </>
                  }
                />
              ) : null}
              {podePickList ? (
                <Botao variante="cheio" tamanho="p" href="/picklist" className="hidden md:inline-flex">
                  Abrir pick list
                </Botao>
              ) : null}
            </>
          }
        />

        {reposicao.ok ? (
          !temItens ? (
            <Cartao>
              <p className="m-0 py-6 text-center text-[15px] text-sec">
                Nada para repor: nenhum produto com venda recente está zerado ou acabando.
              </p>
            </Cartao>
          ) : (
            <>
              {/* Computador */}
              <Cartao className="hidden md:block">
                <div className="flex flex-wrap items-center gap-7">
                  <div>
                    <div className="text-[13px] text-sec">Zerados</div>
                    <div className="text-[28px] font-bold tabular-nums text-vermelho-texto">
                      <span aria-hidden="true">■ </span>
                      {formatInt(zerados.length)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[13px] text-sec">Acabando</div>
                    <div className="text-[28px] font-bold tabular-nums text-laranja-texto">
                      <span aria-hidden="true">▲ </span>
                      {formatInt(acabando.length)}
                    </div>
                  </div>
                  <p className="m-0 min-w-0 flex-[1_1_320px] text-[15px] text-texto">
                    {insightReposicao(zerados, acabando)}
                  </p>
                </div>
              </Cartao>

              <div className="hidden gap-4 md:grid md:grid-cols-2">
                {zerados.length > 0 ? (
                  <Secao
                    titulo={`■ Zerados · ${formatInt(zerados.length)}`}
                    subtitulo="Vendiam e acabaram."
                    tom="vermelho"
                    itens={fatia(zerados, pz)}
                    comLoja={comLoja}
                    rodape={<PaginacaoLinks pagina={pz} total={zerados.length} porPagina={POR_PAGINA} href={(n) => link("pz", n)} />}
                  />
                ) : null}
                {acabando.length > 0 ? (
                  <Secao
                    titulo={`▲ Acabando · ${formatInt(acabando.length)}`}
                    subtitulo="O saldo atual dura menos de 5 dias."
                    tom="laranja"
                    itens={fatia(acabando, pa)}
                    comLoja={comLoja}
                    rodape={<PaginacaoLinks pagina={pa} total={acabando.length} porPagina={POR_PAGINA} href={(n) => link("pa", n)} />}
                  />
                ) : null}
              </div>

              {/* Celular */}
              <div className="md:hidden">
                <ReposicaoCelular
                  org={org.slug}
                  loja={org.loja}
                  zerados={zerados}
                  acabando={acabando}
                  podePickList={podePickList}
                  comLoja={comLoja}
                />
              </div>
            </>
          )
        ) : (
          <Offline error={reposicao.error} />
        )}
      </Pagina>
    </div>
  );
}
