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
    <div role="status" className="vidro rounded-[20px] border-[1.5px] border-dashed border-tracejado p-6 text-center">
      <p className="m-0 text-[15px] font-semibold text-texto">
        <span aria-hidden="true" className="text-laranja-texto">▲ </span>
        Não foi possível carregar os dados
      </p>
      <p className="m-0 mt-1 text-[13px] text-sec">
        Recarregue a página; se o problema continuar, avise quem administra o
        painel.
      </p>
      <details className="mt-3 text-[13px] text-sec">
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-azul-texto md:min-h-0">detalhe técnico</summary>
        <p className="m-0 mt-1 break-words font-mono text-[12px]">{error}</p>
      </details>
    </div>
  );
}
