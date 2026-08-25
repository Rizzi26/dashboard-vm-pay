/**
 * Esqueleto de navegação: aparece na hora em que o usuário toca num link,
 * enquanto o servidor busca os dados da página de destino. Sem ele, a tela
 * anterior fica congelada e a navegação "parece" travada.
 */
export default function Loading() {
  return (
    <div className="viz-root min-h-screen bg-[var(--surface-0)]">
      <div className="border-b border-[var(--grid)]">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="h-4 w-40 animate-pulse rounded bg-[var(--grid)]" />
          <div className="h-4 w-24 animate-pulse rounded bg-[var(--grid)]" />
        </div>
      </div>
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
        <div className="h-7 w-44 animate-pulse rounded bg-[var(--grid)]" />
        <div className="mt-2 h-4 w-64 animate-pulse rounded bg-[var(--grid)]" />
        <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-xl border border-[var(--grid)] bg-[var(--surface-1)]"
            />
          ))}
        </div>
        <div className="mt-6 h-72 animate-pulse rounded-xl border border-[var(--grid)] bg-[var(--surface-1)]" />
      </main>
    </div>
  );
}
