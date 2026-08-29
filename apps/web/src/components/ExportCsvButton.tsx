"use client";

import { useState } from "react";
import { browserApi } from "@/lib/api";
import { supabaseBrowser } from "@/lib/supabase/browser";

/** Baixa um CSV autenticado da API. O papel é checado no servidor, não aqui. */
export function ExportCsvButton({ path, filename }: { path: string; filename: string }) {
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
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={exportar}
        disabled={baixando}
        className="whitespace-nowrap rounded-md border border-[var(--grid)] px-3 py-1.5 text-sm text-[var(--text-primary)] hover:border-[var(--accent)] disabled:cursor-wait disabled:opacity-60"
      >
        {baixando ? "Baixando…" : "Exportar CSV"}
      </button>
      {erro ? <span className="text-xs text-[var(--status-critical)]">{erro}</span> : null}
    </span>
  );
}
