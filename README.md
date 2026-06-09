# GLC Atende

Painel e bot interno da GLC Internet para atendimento, consultas IXC, financeiro seguro, Telegram, Evolution API e automacoes assistidas.

## Estado de producao

- Aplicacao principal: `glc-atende`
- Stack: Next.js 16, TypeScript, Docker e Traefik
- Dominio publico: `https://atende.glcinternet.com.br`
- Porta interna do app: `127.0.0.1:3000`
- Reverse proxy: Traefik em `80/443`
- Acesso operacional: SSH via Tailscale usando usuario `openclaw`
- Evolution API: local em `127.0.0.1:8080`
- IXC: modo read-only por padrao
- Telegram: bot interno com allowlist, perfis e webhook secret

Railway/Vercel nao sao o caminho principal de producao atual. O deploy real do GLC Atende roda em VPS com Docker. O `Caddyfile.example` fica apenas como referencia historica/alternativa, caso um proxy diferente do Traefik seja adotado.

## Arquitetura resumida

```text
Internet
  -> Traefik 80/443
    -> glc-atende 127.0.0.1:3000

srv1652531
  -> acesso operacional via Tailscale/SSH
    -> srv1541068 /docker/glc-atende

glc-atende
  -> IXC API read-only
  -> Telegram Bot API
  -> Evolution API local
  -> arquivos persistentes em DATA_DIR
```

## Principais recursos

- Dashboard interno protegido.
- Webhook IXC para chamados.
- Bot Telegram interno.
- Consulta de chamados, clientes, contratos e faturas.
- Ficha Cliente 360.
- Fatura segura: bloqueia zero ou multiplas faturas.
- Diagnostico financeiro IXC read-only.
- `/inadimplentes`, `/sem_boleto`, `/rf`.
- Reenvio assistido de boleto com fila de aprovacao.
- Webhook Evolution para entrada WhatsApp, sem resposta automatica ao cliente.
- Regua de cobranca em modo controlado/bloqueado por flag.
- Auditoria e retencao de logs.

## Variaveis de ambiente

Use `.env.example` como lista de nomes e comentarios. Preencha valores reais apenas no servidor/ambiente seguro.

Regras:

- Nunca commitar `.env`.
- Nunca commitar backups `.env.backup-*`.
- Nunca expor tokens, senhas, cookies, certificados ou chaves privadas.
- Em producao, `TELEGRAM_WEBHOOK_SECRET` deve estar configurado; webhook Telegram sem secret retorna erro.
- `IXC_WRITE_ENABLED` deve ficar ausente ou diferente de `1` ate aprovacao formal para escrita IXC.
- `BILLING_CADENCE_WHATSAPP_ENABLED` deve ficar desabilitado ate aprovacao para envio real ao cliente.

## Endpoints principais

### Publicos/controlados

- `GET /api/health`: health simples, sem IXC, sem variaveis e sem dados de cliente.
- `GET /api/ixc/webhook`: healthcheck do app.
- `POST /api/ixc/webhook`: protegido por `IXC_WEBHOOK_SECRET`.
- `POST /api/telegram/webhook`: protegido por `TELEGRAM_WEBHOOK_SECRET`.
- `POST /api/evolution/webhook`: protegido por `EVOLUTION_WEBHOOK_SECRET`.

### Internos/protegidos

- `/dashboard`
- `/api/chamados`
- `/api/cliente360`
- `/api/financeiro/*`
- `/api/financeiro/diagnostico`: decisao atual: endpoint interno por `MONITOR_SECRET`, liberado do proxy de sessao para permitir health/monitoramento seguro por segredo.

## Telegram

Comandos principais:

```text
/menu
/status_glc ou /sg
/resumo_dia ou /rd
/chamados
/cliente TERMO ou /c TERMO
/cliente360 TERMO ou /360 TERMO
/contratos TERMO
/faturas ID_CLIENTE
/fatura_segura ID_CLIENTE ou /fs ID_CLIENTE
/reenvio_boleto ID_CLIENTE ou /rb ID_CLIENTE
/boleto ID_CLIENTE
/resumo_financeiro ou /rf
/inadimplentes [limite]
/sem_boleto [limite]
/aprovacoes
```

Seguranca:

- Acesso por allowlist de usuario/grupo.
- Perfis por `TELEGRAM_ATTENDANTS`.
- IDs devem ficar no `.env`, nao hardcoded.
- Nenhum envio externo a cliente deve ocorrer sem aprovacao humana.

## IXC

Modo atual: **read-only**.

Permitido:

- Consultar chamados.
- Consultar cliente.
- Consultar contratos.
- Consultar faturas abertas.
- Consultar dados/PDF de boleto.
- Diagnosticar inadimplencia.

Bloqueado por padrao:

- Responder chamado no IXC.
- Fechar chamado no IXC.
- Gerar/atualizar boleto.
- Enviar boleto por IXC.
- Baixar titulo/pagamento.

Funcoes de escrita devem validar `IXC_WRITE_ENABLED=1` e ainda depender de aprovacao humana/documentada.

## Evolution / WhatsApp

Estado atual:

- Evolution API roda localmente.
- Webhook de entrada salva/notifica mensagens.
- Envio automatico ao cliente continua bloqueado por politica e flag.

Antes de qualquer envio real:

- confirmar numero oficial;
- confirmar texto;
- confirmar opt-out;
- confirmar horario permitido;
- registrar auditoria;
- exigir aprovacao humana.

## Persistencia

O app usa `DATA_DIR` para arquivos persistentes:

- auditoria;
- deduplicacao IXC;
- aprovacoes financeiras;
- dados auxiliares do dashboard.

Dados financeiros como linha digitavel, PIX copia-e-cola e links de boleto sao sensiveis. A retencao deve ser curta e revisada antes de escalar para multioperador.

## Desenvolvimento local

```bash
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit
pnpm lint
pnpm build
pnpm dev
```

## Deploy

Ver `DEPLOY_RUNBOOK_GLC.md`.

Resumo seguro:

```bash
cd /docker/glc-atende
pnpm exec tsc --noEmit
pnpm lint
pnpm build
docker compose up -d --build glc-atende
curl -sI http://127.0.0.1:3000/api/health
```

Executar deploy em producao somente com aprovacao humana e janela apropriada.

## Seguranca

Ver `SECURITY_CHECKLIST_GLC.md`.

Principios:

- minimo privilegio;
- leitura antes de escrita;
- auditoria sempre;
- nenhum segredo em Git;
- aprovacao humana para cliente, financeiro, DNS, banco, IXC escrita e WhatsApp/e-mail.
