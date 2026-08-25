import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { AUTH_COOKIE } from "./browser";

/**
 * No servidor, SUPABASE_URL (se definida) vence a NEXT_PUBLIC_: dentro de um
 * container o Supabase interno tem outro hostname (http://auth:9999 no compose)
 * do que o que o browser enxerga (http://localhost:9999). Fora de container as
 * duas são iguais e só a NEXT_PUBLIC_ existe.
 */
export const SUPABASE_SERVER_URL =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!;

/** Cliente Supabase para Server Components — lê a sessão dos cookies. */
export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(
    SUPABASE_SERVER_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: { name: AUTH_COOKIE },
      cookies: {
        getAll: () => store.getAll(),
        // Server Component não escreve cookie; o refresh acontece no proxy.
        setAll: () => {},
      },
    },
  );
}

export async function accessToken(): Promise<string | null> {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
