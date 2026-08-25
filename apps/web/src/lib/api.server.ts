/**
 * Lado servidor do cliente da API — usa next/headers via supabase/server, e por
 * isso NUNCA pode ser importado por client component (o build quebra, e deve).
 */

import type {
  ActionRow,
  DailyPoint,
  Fetched,
  LostSales,
  MachineRow,
  Me,
  MemberRow,
  ProductDetail,
  StockRow,
  Summary,
  SyncRow,
} from "@/lib/api";
import { accessToken } from "@/lib/supabase/server";

const SERVER_BASE = process.env.API_URL ?? "http://localhost:8000";

async function serverGet<T>(path: string): Promise<Fetched<T>> {
  try {
    const token = await accessToken();
    if (!token) return { ok: false, error: "sessão expirada" };
    // Dado autenticado não entra em cache compartilhado.
    const res = await fetch(`${SERVER_BASE}${path}`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { ok: false, error: `backend respondeu ${res.status}` };
    return { ok: true, data: (await res.json()) as T };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "backend inacessível" };
  }
}

export const serverApi = {
  me: () => serverGet<Me>("/me"),
  summary: (org: string, qs = "") => serverGet<Summary>(`/orgs/${org}/sales/summary${qs}`),
  daily: (org: string, qs = "") => serverGet<DailyPoint[]>(`/orgs/${org}/sales/daily${qs}`),
  byMachine: (org: string, qs = "") =>
    serverGet<MachineRow[]>(`/orgs/${org}/sales/by-machine${qs}`),
  syncStatus: (org: string) => serverGet<SyncRow[]>(`/orgs/${org}/sales/sync-status`),
  lost: (org: string, qs = "") => serverGet<LostSales>(`/orgs/${org}/sales/lost${qs}`),
  product: (org: string, id: string, qs = "") =>
    serverGet<ProductDetail>(`/orgs/${org}/products/${id}${qs}`),
  stock: (org: string) => serverGet<StockRow[]>(`/orgs/${org}/stock`),
  members: (org: string) => serverGet<MemberRow[]>(`/orgs/${org}/members`),
  actions: (org: string) => serverGet<ActionRow[]>(`/orgs/${org}/stock/actions`),
};
