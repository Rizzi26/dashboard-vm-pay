import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { AUTH_COOKIE } from "@/lib/supabase/browser";

/**
 * Guarda de sessão. Sem usuário -> /login; com usuário em /login -> /.
 *
 * A revalidação usa getUser() (bate no Supabase), não getSession() — cookie
 * adulterado não passa. O papel por organização é decidido no FastAPI, que
 * consulta o banco; aqui só se decide "está logado ou não".
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    // No servidor a URL interna (SUPABASE_URL) vence — ver lib/supabase/server.ts.
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: { name: AUTH_COOKIE },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isLogin = path.startsWith("/login");
  // /definir-senha recebe o token do convite/recuperação no fragment (#...),
  // que nunca chega ao servidor: aqui não há como saber se o usuário está
  // "logado", então a página decide sozinha no browser.
  if (path.startsWith("/definir-senha")) {
    return response;
  }
  if (!user && !isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  if (user && isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  // Estáticos e favicon ficam fora; todo o resto passa pela guarda.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.svg$).*)"],
};
