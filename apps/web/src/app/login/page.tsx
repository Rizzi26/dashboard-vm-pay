"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = supabaseBrowser();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      // Mensagem genérica de propósito: não confirmar se o email existe.
      setError("Email ou senha incorretos.");
      setBusy(false);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <main className="viz-root flex min-h-screen items-center justify-center bg-[var(--surface-0)] px-6">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-xl border border-[var(--grid)] bg-[var(--surface-1)] p-6 shadow-[var(--shadow-card)]"
      >
        <h1 className="text-lg font-semibold text-[var(--text-primary)]">Entrar</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Acesso ao painel do mercadinho.
        </p>

        <label className="mt-5 block text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">
          Email
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-md border border-[var(--grid)] bg-transparent px-3 py-2 text-base text-[var(--text-primary)] focus:border-[var(--accent)] sm:text-sm"
          />
        </label>

        <label className="mt-4 block text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">
          Senha
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-md border border-[var(--grid)] bg-transparent px-3 py-2 text-base text-[var(--text-primary)] focus:border-[var(--accent)] sm:text-sm"
          />
        </label>

        {error ? (
          <p role="alert" className="mt-3 text-sm text-[var(--status-critical)]">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy}
          className="mt-5 w-full rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--accent-contrast)] disabled:opacity-60"
        >
          {busy ? "Entrando…" : "Entrar"}
        </button>

        <p className="mt-4 text-xs text-[var(--text-secondary)]">
          Sem acesso? Peça um convite ao responsável pela sua organização.
        </p>
      </form>
    </main>
  );
}
