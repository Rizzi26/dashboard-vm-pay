"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { browserApi } from "@/lib/api";
import { Botao } from "@/components/ui/Botao";
import { CAMPO, Folha, ROTULO_CAMPO, RodapeFolha } from "@/components/ui/Folha";
import { supabaseBrowser } from "@/lib/supabase/browser";

/**
 * Excluir do cadastro da VMpay — só produto que nunca foi para loja (o
 * servidor confere: prateleira, vendas, cargas, histórico). Produto com
 * história se tira de linha. Exclusão não se desfaz: pede o nome digitado.
 */
export function ExcluirProduto({ org, productId, nome }: { org: string; productId: string; nome: string }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [confirmar, setConfirmar] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function excluir(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErro(null);
    try {
      const { data } = await supabaseBrowser().auth.getSession();
      if (!data.session) throw new Error("sessão expirada — entre de novo");
      const resp = await browserApi.request(
        `/orgs/${org}/products/${productId}?confirmar=${encodeURIComponent(confirmar)}`,
        data.session.access_token,
        { method: "DELETE" },
      );
      const payload = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(payload.detail ?? `backend respondeu ${resp.status}`);
      router.push("/prateleira");
    } catch (err) {
      setErro(err instanceof Error ? err.message : "falha ao excluir");
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-tracejado px-4 py-3 text-[14px] text-sec">
        <span>
          Excluir do cadastro só vale para produto que nunca foi para loja. Com vendas ou prateleira, tire de linha.
        </span>
        <Botao variante="perigo" tamanho="p" onClick={() => setAberto(true)}>
          Excluir do cadastro
        </Botao>
      </div>
      {aberto ? (
        <Folha
          titulo="Excluir do cadastro"
          subtitulo="Some da VMpay e do painel. Não dá para desfazer."
          onFechar={() => setAberto(false)}
          onSubmit={excluir}
        >
          <label className={ROTULO_CAMPO}>
            Para confirmar, digite o nome: <strong className="text-texto">{nome}</strong>
            <input autoFocus value={confirmar} onChange={(e) => setConfirmar(e.target.value)} className={CAMPO} />
          </label>
          {erro ? (
            <p role="alert" className="mt-3 text-[14px] text-vermelho-texto">
              ■ {erro}
            </p>
          ) : null}
          <RodapeFolha>
            <Botao variante="tingido" tamanho="g" onClick={() => setAberto(false)}>
              Cancelar
            </Botao>
            <Botao
              type="submit"
              variante="perigo"
              tamanho="g"
              disabled={busy || confirmar.trim().toLowerCase() !== nome.trim().toLowerCase()}
            >
              {busy ? "Excluindo…" : "Excluir"}
            </Botao>
          </RodapeFolha>
        </Folha>
      ) : null}
    </>
  );
}
