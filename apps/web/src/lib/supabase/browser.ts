import { createBrowserClient } from "@supabase/ssr";

/**
 * Nome FIXO do cookie de sessão, igual nos três clientes (browser, server,
 * proxy). Sem isso o @supabase/ssr deriva o nome da URL do projeto — e quando
 * servidor e browser enxergam o Supabase por hosts diferentes (compose:
 * http://auth:9999 vs http://localhost:9999), cada lado procura um cookie que
 * o outro nunca escreveu e a sessão "some".
 */
export const AUTH_COOKIE = "sb-vmpay-auth";

export function supabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookieOptions: { name: AUTH_COOKIE } },
  );
}
