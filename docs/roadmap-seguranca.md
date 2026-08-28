# Roadmap — Segurança por câmera (vm-vision)

> **Status: plano futuro, não iniciado** (registrado em 28/08/2026). Nada disto está implementado.
> Base de código de referência: [vahapogut/Theft-Detection](https://github.com/vahapogut/Theft-Detection)
> (MIT) — FastAPI + YOLOv8 (pose) + face_recognition + alertas Telegram, analisado linha a linha antes
> deste plano.

## Visão geral

Adicionar ao vm-pay um perímetro de segurança por visão computacional para o mercado autônomo:
câmera do mercado → serviço de IA local → alertas Telegram com foto + histórico no dashboard.

Em três fases:

1. **Fase 1 (este documento)** — perímetro + alertas Telegram, integrado ao dashboard.
2. **Fase 2** — correlação sessão×venda: pessoa interagiu com prateleira e saiu sem nenhuma venda
   (`cashless_facts`) na janela `[t0, t1+folga]` → evento "revisar clipe". Exige poller VMpay local
   mais frequente que o cron (10–15s ≈ 6 req/min do limite de 300) porque a VMpay não tem webhook.
   Clipes de vídeo entram aqui.
3. **Fase 3** — refinamentos (valor da venda × interações estimadas, multi-câmera).

O que a câmera **não** consegue (limite conhecido, não tentar): saber *o que* a pessoa pegou
(reconhecimento de produto na mão não funciona com YOLOv8n) nem casar pagamento com indivíduo
específico quando há mais de uma pessoa na loja. Por isso a correlação é por sessão+tempo, e alerta
ambíguo é sempre "revisar", nunca acusação.

## Arquitetura (fase 1)

```
  Câmera RTSP ──LAN──▶ apps/vision (mini PC no condomínio)
                            │  YOLOv8-pose + face_recognition
                            │
              ┌─────────────┼──────────────────┐
              ▼             ▼                  ▼
         Telegram      Supabase           Cloudflare Tunnel
         (alerta+foto) (alertas, rostos,  (wss:// pro vivo e ROI)
                        fotos no Storage)      │
                            ▲                  │
                            │ leitura          │
                     apps/api (Render)         │
                            ▲                  │
                            │ JWT              │
                     apps/web (Vercel) ◀───────┘
                     seção /seguranca
```

Decisões já tomadas:

| Decisão | Escolha |
|---|---|
| Processamento | **Local** (mini PC N100+, 8–16 GB na LAN do mercado) — YOLOv8n roda em CPU a 5–10 FPS; o serviço é um *produtor* de dados do Supabase, como o worker de ingestão |
| Frontend | **Centralizado no `apps/web`** (seção `/seguranca`); o dashboard Next.js do Theft-Detection morre — só o canvas de ROI dele é portado |
| Persistência | **Supabase** (schema `vision` + Storage), não SQLite; SQLite local sobrevive só como buffer de retry se a internet cair (Telegram dispara independente) |
| Leitura no dashboard | Via `apps/api` com o RBAC existente (padrão do projeto: schemas fora do PostgREST) |
| Vivo + ROI + cadastro de rosto | Direto no serviço local via **Cloudflare Tunnel** (`cloudflared` em container, `wss://` com TLS, sem porta aberta no roteador); auth POC = bearer token estático, upgrade = validar JWT do Supabase como o `apps/api` |
| Face recognition | **Mantido** (whitelist morador / blacklist) — a foto do alerta já mostra a pessoa sem ele; o que ele adiciona é *nomear*. ⚠️ POC: antes de produção, cadastro de rosto precisa de base legal (LGPD — biometria é dado sensível) |

## Risco nº 1 — a câmera do mercado

A câmera atual aparenta ser "de app" (cloud P2P — Mibo/Ezviz/Tapo/Yoosee…). A IA precisa do stream
bruto via **RTSP/ONVIF na rede local**; o app do fabricante não entrega vídeo pra processar. Cenários:

1. A câmera tem RTSP e é só ativar no app (Tapo e Ezviz têm; Intelbras Mibo varia por modelo).
2. Cloud-only → comprar câmera com RTSP (R$ 150–300) e manter a do app em paralelo.
3. Existe DVR/NVR no local → quase todo DVR expõe RTSP por canal (melhor cenário).

Em qualquer cenário o mini PC continua necessário. **Primeira ação da fase 1: identificar
marca/modelo e testar `ffprobe "rtsp://user:senha@ip:554/..."` na rede de lá.** Todo o resto se
desenvolve com webcam de teste enquanto isso.

Posicionamento: câmera **zenital (reto pra baixo) quebra a estimativa de pose** (o modelo precisa ver
ombros/punhos/quadril). Ideal: canto alto a ~45° cobrindo entrada + prateleiras + terminal. Zenital
serve só pra presença/zona (bounding box), não pra gestos.

## O que aproveitar / corrigir do Theft-Detection (lido no código, commit de ago/2026)

Aproveitar: `ThreadedCamera` (RTSP em thread), `CameraManager` (multi-câmera, ROI por câmera),
loop YOLOv8-pose com tracking, heurísticas de reaching/concealment/bending/loitering,
`trigger_alert` (foto + Telegram `sendPhoto`), face_recognition com whitelist/blacklist, heatmap,
e o canvas de desenhar ROI do dashboard (portar pro `apps/web`).

Corrigir/remover:

- `shoplifting.pt` que o código tenta carregar **não existe no repo** — o caminho real é o fallback
  `yolov8n.pt` + heurísticas de pose. Não caçar esse modelo.
- `LOITERING_THRESHOLD = 5.0` s hardcoded — em mercado, 5 s parado é cliente comprando. Vira config
  em minutos.
- Concealment vai gerar falso positivo em série em mercado autônomo (pegar produto e pôr na sacola é
  comportamento normal do cliente) — entra como severidade "revisar", nunca "furto".
- `ALERT_COOLDOWN = 3.0` s global por câmera → cooldown por (câmera, regra).
- `person_states` cresce sem limite (vaza memória em 24/7) — limpar tracks sumidos.
- Uma ROI única por câmera → zonas nomeadas com tipo (`restrita`, `loja`, `terminal`).
- Remover caminho de e-mail/SMTP (Telegram basta) e o dashboard Next dele.
- API sem autenticação nenhuma — nunca expor sem o tunnel + token.
- Mensagens em pt-BR.

## Etapas da fase 1

**Etapa 0 — Descoberta e pré-requisitos**: câmera (acima), mini PC, bot Telegram via @BotFather +
grupo + `chat_id` (o backend tem `POST /settings/test`).

**Etapa 1 — `apps/vision`** (fork limpo, Python com `uv` como `apps/api`). ⚠️ Repo é público:
`cameras.json` (credencial RTSP) e `.env` (token do bot, chave Supabase) gitignorados desde o
commit 1, com `cameras.example.json`. Persistência → Supabase + Storage com buffer local de retry.
Cadastro de rosto é endpoint do próprio serviço (computa o encoding na hora), chamado via tunnel.

**Etapa 2 — Migration `vision`**: `alert` (camera, regra, severidade, mensagem, foto_path,
rosto_id?, revisado, created_at), `face` (nome, tipo, encoding bytea, foto_path), `camera` (nome,
zonas jsonb). Bucket privado `vision-alerts` (URL assinada). Endpoints de leitura no `apps/api`:
`GET/PATCH /security/alerts`, `GET /security/faces`.

**Etapa 3 — `/seguranca` no `apps/web`**: lista de alertas com foto e "revisado/falso positivo";
`/seguranca/cameras` (vivo via wss + canvas de zonas); `/seguranca/rostos` (upload via tunnel).

**Etapa 4 — Regras**:

| Regra | Severidade |
|---|---|
| Pessoa em zona `restrita` (estoque) | 🔴 alta |
| Rosto blacklist reconhecido | 🔴 alta |
| Permanência > 10 min na loja | 🟡 média |
| Gesto de ocultação | 🔵 revisar |
| Câmera sem sinal > 60 s | ⚙️ operacional |

A regra de zona restrita é a mais confiável (presença simples, sem pose) — é o coração da fase 1.

**Etapa 5 — Telegram anti-spam**: teto por regra/hora (ex.: 6) com mensagem agregada acima disso.
Sem isso o grupo silencia o bot na primeira semana.

**Etapa 6 — Deploy**: docker-compose no mini PC (`apps/vision` + `cloudflared`),
`restart: unless-stopped`, retenção de fotos 30 dias.

**Etapa 7 — Calibração em modo sombra (1–2 semanas)**: alertas só num chat privado; revisão diária;
teste encenado (entrar na zona restrita, "ocultar" produto). Critério de saída: **< 5 falsos
positivos/dia e 100 % nos testes encenados**.

**Etapa 8 — Go-live**: placa de "ambiente monitorado" (obrigação LGPD independente do sistema),
trocar pro grupo real, runbook no README do `apps/vision`.

Ordem: 0 → 1 → 2 → 3 → 5 → 6 (tudo com webcam de teste) → 4 → 7 → 8. Etapas 1–2 ≈ um fim de
semana; Etapa 3 ≈ outro; Etapa 7 é calendário, não esforço.
