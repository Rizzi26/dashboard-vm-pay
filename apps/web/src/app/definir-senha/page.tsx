"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Botao } from "@/components/ui/Botao";
import { IconeLoja } from "@/components/ui/icones";
import { supabaseBrowser } from "@/lib/supabase/browser";

// O mesmo campo da tela de entrada (form_login da proposta).
const inputClass =
  "mt-1 block h-12 w-full rounded-xl border border-campo-borda bg-campo px-3.5 text-[16px] text-texto outline-none focus:border-azul";

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
    <main className="flex min-h-screen items-center justify-center px-4 py-6 md:p-6">
      <form
        onSubmit={submit}
        className="vidro-forte flex w-full max-w-[358px] flex-col gap-3.5 rounded-[28px] px-7 py-8 md:max-w-[400px]"
      >
        <span
          aria-hidden="true"
          className="flex h-14 w-14 items-center justify-center self-center rounded-2xl text-white"
          style={{ background: "var(--marca)" }}
        >
          <IconeLoja tamanho={28} />
        </span>
        <h1 className="m-0 mt-1 text-center text-[28px] font-bold tracking-[-0.02em] text-texto">Definir senha</h1>

        {ready === "loading" ? (
          <p role="status" className="m-0 text-center text-[15px] text-sec">Validando o link…</p>
        ) : null}

        {ready === "invalid" ? (
          <>
            <p role="alert" className="m-0 text-center text-[15px] text-vermelho-texto">
              ■ Este link é inválido ou expirou.
            </p>
            <p className="m-0 text-center text-[13px] text-sec">
              Peça um novo convite ao responsável pela sua organização, ou use
              &ldquo;esqueci a senha&rdquo; na{" "}
              <a href="/login" className="text-azul-texto">
                tela de entrada
              </a>
              .
            </p>
          </>
        ) : null}

        {ready === "ok" ? (
          <>
            <p className="m-0 mb-1.5 text-center text-[15px] text-sec">
              Escolha a senha que você vai usar para entrar no painel.
            </p>

            <label className="text-[13px] text-sec">
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

            <label className="text-[13px] text-sec">
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
              <p role="alert" className="m-0 text-[14px] text-vermelho-texto">
                ■ {error}
              </p>
            ) : null}

            <Botao type="submit" variante="cheio" tamanho="g" largo disabled={busy} className="mt-1.5">
              {busy ? "Salvando…" : "Salvar e entrar"}
            </Botao>
          </>
        ) : null}
      </form>
    </main>
  );
}
