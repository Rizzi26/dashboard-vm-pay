"use client";

import { useState, type ReactNode } from "react";
import { Botao, type TamanhoBotao, type VarianteBotao } from "@/components/ui/Botao";
import { browserApi } from "@/lib/api";
import { supabaseBrowser } from "@/lib/supabase/browser";

/** Baixa um CSV autenticado da API. O papel é checado no servidor, não aqui. */
export function ExportCsvButton({
  path,
  filename,
  rotulo = "Exportar CSV",
  tamanho = "m",
  variante = "tingido",
  className = "",
}: {
  path: string;
  filename: string;
  /** "CSV" no topo do celular, onde o rótulo longo não cabe. */
  rotulo?: ReactNode;
  tamanho?: TamanhoBotao;
  variante?: VarianteBotao;
  className?: string;
}) {
  const [baixando, setBaixando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function exportar() {
    try {
      setBaixando(true);
      setErro(null);
      const { data } = await supabaseBrowser().auth.getSession();
      if (!data.session) throw new Error("sessão expirada — entre de novo");
      const resp = await browserApi.request(path, data.session.access_token);
      if (!resp.ok) throw new Error(`backend respondeu ${resp.status}`);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "falha na exportação");
    } finally {
      setBaixando(false);
    }
  }

  return (
    <span className={`inline-flex flex-col items-end gap-1 ${className}`}>
      <Botao variante={variante} tamanho={tamanho} onClick={exportar} disabled={baixando} aria-busy={baixando}>
        {baixando ? "Baixando…" : rotulo}
      </Botao>
      {erro ? (
        <span role="alert" className="text-xs text-vermelho-texto">
          {erro}
        </span>
      ) : null}
    </span>
  );
}
