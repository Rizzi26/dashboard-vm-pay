"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { browserApi } from "@/lib/api";
import { supabaseBrowser } from "@/lib/supabase/browser";

/**
 * Logout auditado. Um só lugar porque há dois botões "Sair" (menu do avatar
 * na barra e a tela Mais do celular) e os dois precisam registrar a saída.
 */
export function useSair(org: string) {
  const router = useRouter();
  return useCallback(async () => {
    const supabase = supabaseBrowser();
    // Logout na auditoria ANTES de encerrar: depois não há token para mandar.
    const { data } = await supabase.auth.getSession();
    if (data.session) {
      await browserApi
        .request(`/orgs/${org}/sessao/sair`, data.session.access_token, { method: "POST" })
        .catch(() => undefined);
    }
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }, [org, router]);
}
