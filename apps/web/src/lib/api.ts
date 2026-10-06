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
  /** Janela de mesmo tamanho logo antes — base do "vs período anterior". */
  anterior?: { inicio: string; fim: string; faturamento: number; transacoes: number; ticket_medio: number };
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

export type StockHistoryPoint = {
  em: string;
  local: string;
  quantidade: number;
};

export type ReposicaoItem = {
  location_id: string;
  local: string;
  product_id: string;
  produto: string;
  barcode: string | null;
  quantidade: number;
  status: "ruptura" | "acabando";
  dias_restantes: number;
  vendidas_periodo: number;
  por_dia: number;
  ultima_venda: string | null;
  preco: number | null;
  risco_dia: number | null;
  sugestao: number;
};

export type Reposicao = {
  dias: number;
  resumo: { ruptura: number; acabando: number; risco_dia: number };
  itens: ReposicaoItem[];
};

export type Me = {
  user_id: string;
  email: string | null;
  platform_admin: boolean;
  organizations: {
    slug: string;
    name: string;
    role: string;
    locais?: string[];
    lojas?: { id: string; nome: string }[];
  }[];
};

export type ProductRefs = {
  fabricantes: { id: number; nome: string }[];
  categorias: { id: number; nome: string }[];
  categorias_abastecimento: { id: number; nome: string }[];
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

export type ProductDetail = {
  produto: {
    id: string;
    nome: string;
    barcode: string | null;
    preco: number | null;
    estoque: number;
  };
  periodo: { inicio: string; fim: string };
  resumo: {
    unidades: number;
    faturamento: number;
    preco_medio: number | null;
    ultima_venda: string | null;
  };
  diario: { dia: string; faturamento: number; unidades: number }[];
};

export type PicklistItem = {
  linha: number;
  codigo: string | null;
  descricao: string;
  quantidade: number;
  unidade: string | null;
  valor_unitario: number | null;
  valor_total: number | null;
  product_id: string | null;
  fator: number;
  ignorar: boolean;
  vinculo: "lembrado" | null;
  sugestoes: string[];
};

export type PicklistConsulta = {
  chave: string;
  origem: "qrcode" | "manual";
  fornecedor_cnpj: string;
  consulta_url: string;
  ja_carregado: { status: string; em: string } | null;
  cupom: {
    numero: string;
    serie: string;
    emitido_em: string | null;
    fornecedor_nome: string;
    valor_total: number;
    itens: PicklistItem[];
  } | null;
};

export type PicklistOpcoes = {
  /** conta = integração VMpay do local; com várias contas, filtra os produtos. */
  locais: { id: string; name: string; conta: string | null }[];
  produtos: { id: string; name: string; barcode: string | null; conta?: string }[];
};

export type ContaVmpay = {
  id: string;
  nome: string;
  ativa: boolean;
  principal: boolean;
  token_no_cofre: boolean;
  lojas: string[];
  criada_em: string;
  ultima_leitura: string | null;
  erro: string | null;
};

export type PicklistCarga = {
  id: string;
  access_key: string;
  number: string | null;
  supplier_name: string | null;
  total: number | null;
  status: "pending" | "approved" | "error";
  source: "qrcode" | "manual";
  created_at: string;
  location_name: string;
  itens: number;
};

export type LojaCard = {
  id: string;
  nome: string;
  vendas: {
    hoje: number;
    d7: number;
    d30: number;
    transacoes_30d: number;
    ticket_30d: number;
    ultima_venda: string | null;
  };
  estoque: {
    itens: number;
    zerados: number;
    acabando: number;
    unidades: number;
    atualizado_em: string | null;
  };
};

export type Central = {
  lojas: LojaCard[];
  totais: { hoje: number; d7: number; d30: number; zerados: number; acabando: number };
};

export type EventoAuditoria = {
  fonte: "evento" | "vmpay";
  id: number;
  em: string;
  usuario_id: string;
  usuario: string;
  sessao: string | null;
  acao: string;
  alvo: Record<string, unknown>;
  status: string | null;
  erro: string | null;
  ip: string | null;
  navegador: string | null;
};

export type Auditoria = {
  periodo: { inicio: string; fim: string };
  eventos: EventoAuditoria[];
  pagina: number;
  por_pagina: number;
  total: number;
  proxima: string | null;
  membros: { id: string; email: string; papel: string }[];
};

export type PicklistCupom = {
  id: string;
  chave: string;
  numero: string | null;
  serie: string | null;
  emitido_em: string | null;
  fornecedor: { cnpj: string; nome: string | null };
  valor_total: number | null;
  origem: "qrcode" | "manual";
  status: "pending" | "approved" | "error";
  carregado_em: string;
  loja: string;
  aprovado_por: string;
  vmpay: { status: string | null; erro: string | null };
  itens: {
    linha: number;
    codigo: string | null;
    descricao: string;
    quantidade: number | null;
    unidade: string | null;
    valor_unitario: number | null;
    valor_total: number | null;
    fator: number | null;
    ignorado: boolean;
    produto: { id: string; nome: string } | null;
    entrou: number | null;
  }[];
};

export type Heatmap = {
  periodo: { inicio: string; fim: string };
  celulas: { dia: number; hora: number; faturamento: number; transacoes: number }[];
};

export type CurvaAbc = {
  periodo: { inicio: string; fim: string };
  total: number;
  resumo: Record<"A" | "B" | "C", { produtos: number; faturamento: number }>;
  itens: {
    posicao: number;
    product_id: string | null;
    produto: string;
    faturamento: number;
    unidades: number;
    participacao: number;
    acumulado: number;
    classe: "A" | "B" | "C";
  }[];
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
