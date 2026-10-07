/**
 * Esqueleto de navegação: aparece na hora em que o usuário toca num link,
 * enquanto o servidor busca os dados da página de destino. Sem ele, a tela
 * anterior fica congelada e a navegação "parece" travada.
 *
 * Imita a forma das telas novas (barra flutuante no computador, título
 * grande, tiles e um cartão) para a troca não dar salto de layout.
 */
export default function Loading() {
  const bloco = "animate-pulse rounded-lg bg-trilho";
  return (
    <div className="min-h-screen" aria-busy="true" aria-label="Carregando">
      <div className="mx-auto flex w-full max-w-[1240px] items-center justify-between gap-3 px-4 pt-[max(12px,env(safe-area-inset-top))] md:mt-5 md:w-[calc(100%-48px)] md:rounded-[22px] md:py-3.5 md:pl-3.5 md:pr-3 md:[background:var(--vidro)]">
        <div className={`${bloco} h-5 w-40`} />
        <div className={`${bloco} h-5 w-24`} />
      </div>
      <main className="mx-auto flex w-full max-w-[1240px] flex-col gap-3.5 px-4 pt-3 md:gap-4 md:px-6 md:pt-10">
        <div className={`${bloco} h-3.5 w-36`} />
        <div className={`${bloco} h-9 w-56 md:h-11`} />
        <div className="grid grid-cols-2 gap-3.5 md:grid-cols-3 md:gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className={`vidro h-28 rounded-[20px] ${i === 2 ? "hidden md:block" : ""}`}>
              <div className={`${bloco} m-4 h-3 w-24`} />
              <div className={`${bloco} mx-4 h-7 w-28`} />
            </div>
          ))}
        </div>
        <div className="vidro h-72 rounded-[22px]" />
      </main>
    </div>
  );
}
