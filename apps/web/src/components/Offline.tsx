/**
 * Estado vazio quando o backend não responde.
 *
 * Um bloco que falha não derruba a página: o resto continua renderizando, e este
 * aviso diz o que aconteceu em vez de mostrar zero — zero e "não sei" são coisas
 * diferentes num painel de faturamento.
 *
 * O painel é white-label: quem lê isto é o operador, não quem sobe a API.
 */
export function Offline({ error }: { error: string }) {
  return (
    <div className="rounded-md border border-dashed border-[var(--grid)] p-6 text-center">
      <p className="text-sm text-[var(--text-primary)]">
        Não foi possível carregar os dados
      </p>
      <p className="mt-1 text-xs text-[var(--text-secondary)]">
        Recarregue a página; se o problema continuar, avise quem administra o
        painel.
      </p>
      <details className="mt-3 text-xs text-[var(--text-secondary)]">
        <summary className="cursor-pointer">detalhe técnico</summary>
        <p className="mt-1 font-mono">{error}</p>
      </details>
    </div>
  );
}
