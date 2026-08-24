/**
 * Cliente do backend FastAPI.
 *
 * O dashboard nunca fala com a API da VMpay direto: ela não agrega nada e limita
 * 300 req/min por token. Tudo vem do nosso backend, que lê o que o worker já
 * ingeriu no Supabase.
 */

const BASE = process.env.API_URL ?? "http://localhost:8000";

export type Summary = {
  periodo: { inicio: string; fim: string };
  faturamento: number;
  transacoes: number;
  itens: number;
  descontos: number;
  maquinas_ativas: number;
  ticket_medio: number;
};

export type DailyPoint = {
  dia: string;
  faturamento: number;
  transacoes: number;
};

export type MachineRow = {
  machine_id: number;
  patrimonio: string | null;
  modelo: string | null;
  faturamento: number;
  transacoes: number;
};

export type SyncRow = {
  recurso: string;
  cursor: number;
  registros_ingeridos: number;
  ultima_execucao: string | null;
  ultimo_sucesso: string | null;
  ultimo_erro: string | null;
  atraso_segundos: number | null;
};

export type Fetched<T> = { ok: true; data: T } | { ok: false; error: string };

async function get<T>(path: string): Promise<Fetched<T>> {
  try {
    // Dado de venda envelhece a cada rodada do worker; cache curto em vez de
    // no-store para não bater no backend a cada navegação.
    const res = await fetch(`${BASE}${path}`, { next: { revalidate: 60 } });
    if (!res.ok) {
      return { ok: false, error: `backend respondeu ${res.status}` };
    }
    return { ok: true, data: (await res.json()) as T };
  } catch (err) {
    // Backend fora do ar não pode derrubar a página inteira — cada bloco mostra
    // seu próprio estado vazio.
    return {
      ok: false,
      error: err instanceof Error ? err.message : "backend inacessível",
    };
  }
}

export const api = {
  summary: (qs = "") => get<Summary>(`/sales/summary${qs}`),
  daily: (qs = "") => get<DailyPoint[]>(`/sales/daily${qs}`),
  byMachine: (qs = "") => get<MachineRow[]>(`/sales/by-machine${qs}`),
  syncStatus: () => get<SyncRow[]>(`/sales/sync-status`),
};
