# Segurança MVP - GLC Atende

## O que foi implementado

- Autenticação Basic Auth para:
  - `/dashboard/*`
  - `/api/chamados/*`
- `/api/chamados` agora retorna payload reduzido, sem despejar o retorno bruto completo do IXC.
- Webhook IXC `/api/ixc/webhook` agora exige `IXC_WEBHOOK_SECRET` no POST.
- Webhook IXC aceita segredo por:
  - Header preferencial: `x-glc-webhook-secret`
  - Alternativa: query string `?secret=SEU_SEGREDO`
- Deduplicação de chamados notificados em `DATA_DIR/audit/ixc-chamados-notified.txt`.
- Auditoria mínima em `DATA_DIR/audit/events.jsonl`.
- Telegram registra comandos/callbacks/autorização negada em auditoria.
- Olindo fica restrito a grupo autorizado e horário comercial de Brasília, se `ID_TELEGRAM_OLINDO` estiver configurado.
- Docker Compose agora monta `./data:/app/data` para persistir auditoria/deduplicação.

## Variáveis obrigatórias antes de deploy

```env
DASHBOARD_BASIC_USER=gilson
DASHBOARD_BASIC_PASSWORD=SENHA_FORTE_AQUI
IXC_WEBHOOK_SECRET=SEGREDO_FORTE_AQUI
DATA_DIR=/app/data
```

## URL recomendada para configurar no IXC

Se o IXC não permitir header personalizado:

```text
https://atende.glcinternet.com.br/api/ixc/webhook?secret=SEGREDO_FORTE_AQUI
```

Se o IXC permitir header personalizado, preferir:

```text
URL: https://atende.glcinternet.com.br/api/ixc/webhook
Header: x-glc-webhook-secret: SEGREDO_FORTE_AQUI
```

## Validação feita localmente

- `pnpm lint`: OK
- `pnpm build`: OK
- `/api/chamados` sem autenticação: HTTP 401
- `/api/chamados` com autenticação: HTTP 200
- POST `/api/ixc/webhook` sem segredo: HTTP 401
- POST `/api/ixc/webhook` com segredo: HTTP 200
- POST repetido com mesmo ID: HTTP 200 com `duplicate: true`

## Atenção operacional

Não fazer deploy sem configurar as variáveis de segurança. Caso contrário, o dashboard/API retornarão erro de autenticação/configuração e o webhook IXC recusará POST sem segredo.
