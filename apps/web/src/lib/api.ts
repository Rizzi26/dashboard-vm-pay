/**
 * Tipos da API + cliente de browser.
 *
 * Este módulo é importado por client components, então NÃO pode depender de
 * next/headers — o lado servidor (serverApi) vive em api.server.ts. Toda rota
 * de dados é escopada por organização: /orgs/{slug}/...
 */

const BROWSER_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type Summary = {
  periodo: { inicio: string; fim: string };
  faturamento: number;
  transacoes: number;
  itens: number;
  descontos: number;
  maquinas_ativas: number;
  ticket_medio: number;
};

export type DailyPoint = { dia: string; faturamento: number; transacoes: number };

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

export type StockRow = {
  location_id: string;
  local: string;
  product_id: string;
  produto: string;
  barcode: string | null;
  preco: number | null;
  quantidade: number;
  atualizado_em: string;
};

export type Me = {
  user_id: string;
  email: string | null;
  platform_admin: boolean;
  organizations: { slug: string; name: string; role: string }[];
};

export type MemberRow = {
  user_id: string;
  email: string;
  role: string;
  member_since: string;
};

export type ActionRow = {
  id: number;
  acao: string;
  status: string;
  erro: string | null;
  ator: string | null;
  criada_em: string;
  finalizada_em: string | null;
};

export type LostSales = {
  periodo: { inicio: string; fim: string };
  tentativas: number;
  valor_nao_capturado: number;
  interacoes: number;
  taxa: number;
  motivos: { motivo: string; tentativas: number; valor: number }[];
};

export type Fetched<T> = { ok: true; data: T } | { ok: false; error: string };

/** Chamadas disparadas no browser (ações, export). Recebem o token da sessão. */
export const browserApi = {
  base: BROWSER_BASE,

  async request(path: string, token: string, init?: RequestInit): Promise<Response> {
    return fetch(`${BROWSER_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  },
};
