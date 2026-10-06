import { Header } from "@/components/Header";
import { BotaoSair } from "@/components/ui/BotaoSair";
import { IconeCartao, IconeDinheiro, IconeLinhas, IconePessoas, IconeRelogio } from "@/components/ui/icones";
import { CabecalhoLista, LinhaLista, Lista } from "@/components/ui/Lista";
import { inicialDe } from "@/components/ui/MenuConta";
import { ROLE_LABEL } from "@/components/ui/navegacao";
import { Pagina } from "@/components/ui/Pagina";
import { Titulo } from "@/components/ui/Titulo";
import { serverApi } from "@/lib/api.server";
import { orgSession } from "@/lib/org";

/** Quadradinho colorido com ícone branco, como nos Ajustes do iOS. */
function IconeOpcao({ cor, children }: { cor: string; children: React.ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-[30px] w-[30px] items-center justify-center rounded-lg text-white"
      style={{ background: cor }}
    >
      {children}
    </span>
  );
}

/**
 * "Mais" da barra de abas do celular (CelMais da proposta): a conta e o que
 * não coube nas quatro abas. No computador tudo isto já está na barra do
 * topo, mas a rota funciona igual se alguém abrir o link.
 */
export default async function MaisPage() {
  const { me, org } = await orgSession();
  const ehMaster = org.role === "master" || me.platform_admin;
  const operador = ehMaster || org.role === "admin";
  // Só o número de contas, para o selo ao lado de "Contas VMpay" — e só para
  // master, que é quem as vê na Central (o servidor nega aos demais).
  const contas = ehMaster ? await serverApi.contas(org.slug) : null;

  return (
    <div className="min-h-screen">
      <Header org={org.slug} orgName={org.name} role={org.role} email={me.email} lojas={org.lojas} loja={org.loja} />
      <Pagina largura="estreita">
        <Titulo titulo="Mais" />

        <div className="vidro flex items-center gap-3.5 rounded-[18px] px-4 py-3.5">
          <span
            aria-hidden="true"
            className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full text-[22px] font-semibold text-white"
            style={{ background: "var(--avatar)" }}
          >
            {inicialDe(me.email)}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[17px] font-semibold text-texto">{me.email ?? "—"}</span>
            <span className="block text-[13px] text-sec">
              {ROLE_LABEL[org.role] ?? org.role} · {org.name}
            </span>
          </span>
        </div>

        <CabecalhoLista>Operação</CabecalhoLista>
        <Lista>
          <LinhaLista
            href="/reposicao"
            principal="Reposição"
            esquerda={
              <IconeOpcao cor="#FF9500">
                <IconeLinhas tamanho={17} espessura={2.2} />
              </IconeOpcao>
            }
          />
          {operador ? (
            <LinhaLista
              href="/picklist"
              principal="Cupons carregados"
              esquerda={
                <IconeOpcao cor="#34C759">
                  <IconeDinheiro tamanho={17} espessura={2.2} />
                </IconeOpcao>
              }
            />
          ) : null}
        </Lista>

        {ehMaster ? (
          <>
            <CabecalhoLista>Administração</CabecalhoLista>
            <Lista>
              <LinhaLista
                href="/usuarios"
                principal="Usuários"
                esquerda={
                  <IconeOpcao cor="#007AFF">
                    <IconePessoas tamanho={17} espessura={2.2} />
                  </IconeOpcao>
                }
              />
              <LinhaLista
                href="/auditoria"
                principal="Auditoria"
                esquerda={
                  <IconeOpcao cor="#5856D6">
                    <IconeRelogio tamanho={17} espessura={2.2} />
                  </IconeOpcao>
                }
              />
              <LinhaLista
                href="/#contas"
                principal="Contas VMpay"
                direita={contas?.ok ? <span className="text-[15px] text-sec">{contas.data.length}</span> : null}
                esquerda={
                  <IconeOpcao cor="#8E8E93">
                    <IconeCartao tamanho={17} espessura={2.2} />
                  </IconeOpcao>
                }
              />
            </Lista>
          </>
        ) : null}

        <div className="mt-2">
          <BotaoSair org={org.slug} />
        </div>
      </Pagina>
    </div>
  );
}
