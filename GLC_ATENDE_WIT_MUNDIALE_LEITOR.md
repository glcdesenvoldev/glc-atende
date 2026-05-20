# GLC Atende — Agente Leitor WIT/Mundiale

Data: 2026-05-19

## Status

Implementado endpoint inicial em modo seguro/dry-run:

```txt
GET/POST /api/monitor/wit
```

O endpoint:

- exige `MONITOR_SECRET` via `x-glc-webhook-secret`, `x-webhook-secret` ou `?secret=`;
- não salva senha nem token do WIT;
- lê tickets em atendimento do Dashboard/Atendimento WIT quando recebe autenticação válida; usa tickets pendentes como fallback;
- mascara contato/nome antes de retornar ou alertar;
- registra auditoria mínima em `DATA_DIR/audit/events.jsonl`;
- só notifica Telegram quando chamado com `dryRun=0&notify=1`.

## Arquivos criados

```txt
src/lib/wit.ts
src/app/api/monitor/wit/route.ts
```

## Endpoints WIT usados

### Principal — Dashboard/Atendimento

```txt
GET https://app.withub.ai/api/main/dashboard/metrics/attendances/2157
```

Caminho de tickets normalizado:

```txt
data.deskNotDailyMetrics.ticketsInDesk[]
```

Campos mapeados com dados mínimos/mascarados:

```txt
id
queue
channel
businessStatus.name/label
assignedUserForTicket.name ou userName
clientName
contactOrigin/providerIdentifier
firstResponseAt
```

No teste autenticado via navegador, esse endpoint retornou 5 tickets em atendimento no painel.

### Fallback — Pendentes

```txt
GET https://app.withub.ai/api/main/tickets/pending
```

Esse endpoint pode retornar vazio dependendo da visão/permissão do usuário monitor.

Cabeçalhos necessários nos dois casos:

```txt
Authorization: Bearer <hub_access_token>
idAccount: <hub_account>
```

## Endpoint GLC Atende

### Dry-run com variáveis de ambiente

```bash
curl -H "x-glc-webhook-secret: $MONITOR_SECRET" \
  "https://atende.glcinternet.com.br/api/monitor/wit?dryRun=1"
```

### Dry-run com token temporário via header

Usar somente em teste controlado, nunca em URL:

```bash
curl -H "x-glc-webhook-secret: $MONITOR_SECRET" \
  -H "x-wit-token-type: Bearer" \
  -H "x-wit-access-token: TOKEN_TEMPORARIO" \
  -H "x-wit-account-id: ACCOUNT_ID" \
  "https://atende.glcinternet.com.br/api/monitor/wit?dryRun=1"
```

### Notificação real

```bash
curl -H "x-glc-webhook-secret: $MONITOR_SECRET" \
  "https://atende.glcinternet.com.br/api/monitor/wit?dryRun=0&notify=1"
```

## Variáveis previstas

```txt
WIT_API_BASE=https://app.withub.ai
WIT_OPERATION_ID=2157
WIT_PROVIDER_ID=14
WIT_USER_ID=426f431b-6a72-42c1-a26f-bba28cd838b4
WIT_TOKEN_TYPE=Bearer
WIT_ACCESS_TOKEN=
WIT_ACCOUNT_ID=
TELEGRAM_WIT_NOTIFY_CHAT_IDS=
```

## Próximo passo

Com a aba Atendimento validada:

1. rodar `/api/monitor/wit?dryRun=1` com token de sessão válido;
2. validar retorno sanitizado dos 5 tickets em atendimento;
3. definir regra de alerta por tempo parado/fila/status;
4. configurar renovação segura de sessão/token;
5. configurar agendamento seguro.

## Segurança/LGPD

- Não salvar senha do WIT/Mundiale em código, memória ou logs.
- Não salvar token real em repositório.
- Evitar mensagens completas de clientes.
- Retornar/alertar somente dados mínimos e mascarados.
- Comunicação automática para cliente continua bloqueada sem confirmação humana.
