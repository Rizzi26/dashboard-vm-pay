# web

Dashboard de vendas. Next.js 16 (App Router) + Tailwind 4, deploy na Vercel.

## Onde busca dado

Só do FastAPI, nunca da VMpay direto — ela não agrega e limita 300 req/min por
token. `API_URL` aponta para o backend (Render em produção, `localhost:8000`
local).

Cada bloco trata sua própria falha: backend fora do ar mostra o aviso naquele
card e o resto da página continua. Num painel de faturamento, zero e "não sei"
são coisas diferentes.

## Rodar local

```bash
pnpm install
API_URL=http://localhost:8000 pnpm dev
```

## Decisões de visualização

Seguem o método do skill `dataviz`; a paleta foi validada pelo script dele
(PASS em claro e escuro: banda de luminosidade, piso de croma, contraste ≥ 3:1).

- **Faturamento e transações não dividem o gráfico.** São escalas diferentes, e
  dois eixos y fazem comparar formas que não são comparáveis. Transações ficam no
  tile e no tooltip.
- **Série única, sem legenda** — o título nomeia a série. Rótulo direto só no
  último ponto; número em todo ponto vira ruído.
- **Tabela alternativa** no gráfico, para quem não lê a linha.
- **Status nunca é só cor.** O rodapé de sincronização traz ícone e texto junto —
  `▲ vends atrasado · há 2 h`.
- **Escuro é escolhido, não invertido**: passos próprios da mesma rampa,
  declarados sob `prefers-color-scheme` e sob `[data-theme]`.

Os tokens ficam em `globals.css`, sob `.viz-root`. Os componentes referenciam
papéis (`--series-1`, `--text-secondary`), nunca hex.
