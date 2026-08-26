"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

const inputClass =
  "mt-1 w-full rounded-md border border-[var(--grid)] bg-transparent px-3 py-2 text-base text-[var(--text-primary)] focus:border-[var(--accent)] sm:text-sm";

/**
 * Destino do email de convite e do "esqueci a senha". O Supabase manda o
 * usuário para cá com a sessão no fragment (#access_token=...&type=invite);
 * o cliente do browser lê o fragment sozinho e vira sessão. Só então dá para
 * chamar updateUser({ password }).
 *
 * Sem esta página o convidado "entrava" pelo token do link e ficava sem senha
 * para a próxima vez.
 */
export default function DefinirSenhaPage() {
  const router = useRouter();
  const [ready, setReady] = useState<"loading" | "ok" | "invalid">("loading");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const supabase = supabaseBrowser();
    // O fragment é consumido de forma assíncrona; escutar o evento é mais
    // confiável do que ler getSession() na montagem.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) setReady("ok");
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setReady("ok");
        return;
      }
      // Link expirado/reaproveitado chega como #error=...&error_description=...
      const hash = new URLSearchParams(window.location.hash.slice(1));
      if (hash.get("error")) setReady("invalid");
    });
    // Se em alguns segundos não apareceu sessão, o link não serviu.
    const timer = setTimeout(() => {
      setReady((s) => (s === "loading" ? "invalid" : s));
    }, 4000);
    return () => {
      subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("A senha precisa ter pelo menos 8 caracteres.");
      return;
    }
    if (password !== confirm) {
      setError("As senhas não conferem.");
      return;
    }
    setBusy(true);
    const { error } = await supabaseBrowser().auth.updateUser({ password });
    if (error) {
      setError(
        error.message.includes("different")
          ? "A nova senha precisa ser diferente da atual."
          : "Não foi possível salvar a senha. Peça um novo link.",
      );
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
        <h1 className="text-lg font-semibold text-[var(--text-primary)]">Definir senha</h1>

        {ready === "loading" ? (
          <p className="mt-1 text-sm text-[var(--text-secondary)]">Validando o link…</p>
        ) : null}

        {ready === "invalid" ? (
          <>
            <p role="alert" className="mt-1 text-sm text-[var(--status-critical)]">
              Este link é inválido ou expirou.
            </p>
            <p className="mt-4 text-xs text-[var(--text-secondary)]">
              Peça um novo convite ao responsável pela sua organização, ou use
              &ldquo;esqueci a senha&rdquo; na{" "}
              <a href="/login" className="underline">
                tela de entrada
              </a>
              .
            </p>
          </>
        ) : null}

        {ready === "ok" ? (
          <>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              Escolha a senha que você vai usar para entrar no painel.
            </p>

            <label className="mt-5 block text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">
              Nova senha
              <input
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
              />
            </label>

            <label className="mt-4 block text-xs font-medium uppercase tracking-wide text-[var(--text-secondary)]">
              Confirmar senha
              <input
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className={inputClass}
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
              {busy ? "Salvando…" : "Salvar e entrar"}
            </button>
          </>
        ) : null}
      </form>
    </main>
  );
}
