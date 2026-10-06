"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

import { Paginacao, usePaginacao } from "@/components/Paginacao";
import { detalheItem, POR_PAGINA_REPOSICAO } from "@/components/reposicao-texto";
import { Botao } from "@/components/ui/Botao";
import { CabecalhoLista, LinhaLista, Lista } from "@/components/ui/Lista";
import { Selo } from "@/components/ui/Selo";
import type { ReposicaoItem } from "@/lib/api";
import { formatInt } from "@/lib/format";

/*
 * "Já peguei": o repositor marca no corredor o que já pôs no carrinho. É só
 * conveniência deste aparelho — fica no localStorage, por organização + loja
 * + dia (amanhã a lista recomeça limpa), e nada disso vai para o servidor.
 * O armazenamento pode faltar (aba anônima, site bloqueado): a memória da
 * aba vira a fonte e a marcação vale até recarregar.
 */
const PREFIXO = "vmpay:reposicao:peguei:";
const memoria = new Map<string, string>();
const ouvintes = new Set<() => void>();

function hoje(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function ler(chave: string): string {
  if (memoria.has(chave)) return memoria.get(chave)!;
  try {
    return window.localStorage.getItem(chave) ?? "";
  } catch {
    return "";
  }
}

function gravar(chave: string, valor: string) {
  memoria.set(chave, valor);
  try {
    const ls = window.localStorage;
    ls.setItem(chave, valor);
    // Marcações de outros dias não servem mais: limpa ao gravar.
    for (let i = ls.length - 1; i >= 0; i--) {
      const k = ls.key(i);
      if (k && k.startsWith(PREFIXO) && !k.endsWith(`:${hoje()}`)) ls.removeItem(k);
    }
  } catch {
    // Sem armazenamento: fica só na memória da aba.
  }
  ouvintes.forEach((f) => f());
}

function assinar(aviso: () => void) {
  ouvintes.add(aviso);
  window.addEventListener("storage", aviso);
  return () => {
    ouvintes.delete(aviso);
    window.removeEventListener("storage", aviso);
  };
}

const idItem = (i: ReposicaoItem) => `${i.location_id}:${i.product_id}`;

function Secao({
  titulo,
  tom,
  itens,
  marcados,
  alternar,
  comLoja,
}: {
  titulo: string;
  tom: "vermelho" | "laranja";
  itens: ReposicaoItem[];
  marcados: Set<string>;
  alternar: (id: string) => void;
  comLoja: boolean;
}) {
  const pag = usePaginacao(itens, POR_PAGINA_REPOSICAO);
  if (itens.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <CabecalhoLista tom={tom}>{titulo}</CabecalhoLista>
      <Lista>
        {pag.visiveis.map((i) => {
          const id = idItem(i);
          const campo = `peguei-${id}`;
          const pegou = marcados.has(id);
          return (
            <LinhaLista
              key={id}
              esquerda={
                // O label de 44px é o alvo do toque; a caixa em si tem 24.
                <label htmlFor={campo} className="-m-2.5 flex h-11 w-11 items-center justify-center">
                  <input
                    id={campo}
                    type="checkbox"
                    checked={pegou}
                    onChange={() => alternar(id)}
                    aria-label={`Já peguei ${i.produto}`}
                    className="m-0 h-6 w-6 accent-verde"
                  />
                </label>
              }
              principal={
                <label htmlFor={campo} className={pegou ? "text-terc line-through" : undefined}>
                  {i.produto}
                </label>
              }
              secundario={detalheItem(i, true, comLoja)}
              direita={<Selo tom={tom}>levar {formatInt(i.sugestao)}</Selo>}
            />
          );
        })}
      </Lista>
      <Paginacao {...pag.rodape} />
    </section>
  );
}

/** Reposição no celular: lista de compra com "já peguei" e o atalho do cupom. */
export function ReposicaoCelular({
  org,
  loja,
  zerados,
  acabando,
  podePickList,
  comLoja,
}: {
  org: string;
  loja: string | null;
  zerados: ReposicaoItem[];
  acabando: ReposicaoItem[];
  podePickList: boolean;
  comLoja: boolean;
}) {
  const chave = `${PREFIXO}${org}:${loja ?? "todas"}:${hoje()}`;
  // Snapshot do servidor vazio: tudo desmarcado no HTML, e a marcação do
  // aparelho entra na hidratação sem divergir.
  const bruto = useSyncExternalStore(
    assinar,
    () => ler(chave),
    () => "",
  );
  const marcados = useMemo(() => {
    try {
      const lista: unknown = bruto ? JSON.parse(bruto) : [];
      return new Set(Array.isArray(lista) ? lista.filter((x) => typeof x === "string") : []);
    } catch {
      return new Set<string>();
    }
  }, [bruto]);

  const alternar = useCallback(
    (id: string) => {
      const proximo = new Set(marcados);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      gravar(chave, JSON.stringify([...proximo]));
    },
    [chave, marcados],
  );

  const total = zerados.length + acabando.length;
  const pegos = [...zerados, ...acabando].filter((i) => marcados.has(idItem(i))).length;

  return (
    <div className="flex flex-col gap-3.5">
      <p className="m-0 text-[15px] text-sec" aria-live="polite">
        {pegos > 0
          ? `Já pegou ${formatInt(pegos)} de ${formatInt(total)}. A quantidade cobre uma semana.`
          : "Marque o que já pegou. A quantidade cobre uma semana."}
      </p>
      <Secao
        titulo={`■ Zerados · ${formatInt(zerados.length)}`}
        tom="vermelho"
        itens={zerados}
        marcados={marcados}
        alternar={alternar}
        comLoja={comLoja}
      />
      <Secao
        titulo={`▲ Acabando · ${formatInt(acabando.length)}`}
        tom="laranja"
        itens={acabando}
        marcados={marcados}
        alternar={alternar}
        comLoja={comLoja}
      />
      {podePickList ? (
        <Botao variante="cheio" tamanho="g" largo href="/picklist">
          Comprei — ler o cupom
        </Botao>
      ) : null}
    </div>
  );
}
