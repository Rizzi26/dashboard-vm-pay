/**
 * Estado vazio quando o backend não responde.
 *
 * Um bloco que falha não derruba a página: o resto continua renderizando, e este
 * aviso diz o que aconteceu em vez de mostrar zero — zero e "não sei" são coisas
 * diferentes num painel de faturamento.
 */
export function Offline({ error }: { error: string }) {
  return (
    <div className="rounded-md border border-dashed border-[var(--grid)] p-6 text-center">
      <p className="text-sm text-[var(--text-primary)]">Backend indisponível</p>
      <p className="mt-1 text-xs text-[var(--text-secondary)]">{error}</p>
      <p className="mt-3 text-xs text-[var(--text-secondary)]">
        Suba a API com <code className="font-mono">uvicorn vmpay_api.main:app</code> ou
        aponte <code className="font-mono">API_URL</code> para o serviço no Render.
      </p>
    </div>
  );
}
