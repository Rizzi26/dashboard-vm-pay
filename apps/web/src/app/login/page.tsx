"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Botao } from "@/components/ui/Botao";
import { IconeLoja } from "@/components/ui/icones";
import { supabaseBrowser } from "@/lib/supabase/browser";

// Campo de 48px e fonte de 16px (form_login da proposta): abaixo de 16px o
// iOS dá zoom ao focar.
const CAMPO =
  "mt-1 block h-12 w-full rounded-xl border border-campo-borda bg-campo px-3.5 text-[16px] text-texto outline-none focus:border-azul";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function forgot() {
    setError(null);
    setNotice(null);
    if (!email) {
      setError("Preencha o email para receber o link de redefinição.");
      return;
    }
    setBusy(true);
    await supabaseBrowser().auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/definir-senha`,
    });
    // Mesma mensagem com email existente ou não: não confirmar cadastro.
    setNotice("Se este email tiver acesso, o link de redefinição foi enviado.");
    setBusy(false);
  }

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
        <h1 className="m-0 mt-1 text-center text-[28px] font-bold tracking-[-0.02em] text-texto">Entrar no painel</h1>
        <p className="m-0 mb-1.5 text-center text-[15px] text-sec">
          Vendas, prateleira e reposição das suas lojas.
        </p>

        <label className="text-[13px] text-sec">
          Email
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={CAMPO}
          />
        </label>

        <label className="text-[13px] text-sec">
          Senha
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={CAMPO}
          />
        </label>

        {error ? (
          <p role="alert" className="m-0 text-[14px] text-vermelho-texto">
            ■ {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="m-0 text-[14px] text-sec">
            {notice}
          </p>
        ) : null}

        <Botao type="submit" variante="cheio" tamanho="g" largo disabled={busy} className="mt-1.5">
          {busy ? "Entrando…" : "Entrar"}
        </Botao>

        <button
          type="button"
          onClick={forgot}
          disabled={busy}
          className="min-h-11 self-center border-0 bg-transparent font-[inherit] text-[15px] text-azul-texto disabled:opacity-50"
        >
          Esqueci a senha
        </button>

        <p className="m-0 text-center text-[13px] text-sec">
          Sem acesso? Peça um convite ao responsável pela sua organização.
        </p>
      </form>
    </main>
  );
}
