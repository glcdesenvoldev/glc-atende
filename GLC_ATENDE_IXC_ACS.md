# GLC Atende — Integração IXC ACS

## Objetivo

Adicionar dados do IXC ACS na Ficha 360 do cliente para apoiar atendente e futuro agente IA.

## Fase atual

Modo **somente leitura**.

Permitido:

- localizar CPE/dispositivo;
- consultar status online/offline;
- consultar modelo, serial/MAC, último contato, uptime, IP e Wi-Fi quando a API permitir;
- exibir diagnóstico no `/360`.

Bloqueado nesta fase:

- alterar senha Wi-Fi;
- reboot/reset;
- alteração de parâmetros TR-069;
- firmware;
- ações em massa.

## Cliente API criado no IXC ACS

- Tipo: Genérica
- Nome sugerido: `GLC Atende - Leitura ACS`
- URL ACS: `https://acs.glcinternet.com.br`
- Client ID: `6a179ba2a502f754d0247f4a`

> Não registrar `client secret`, token, chave privada ou credenciais neste arquivo.

## Variáveis de ambiente

```env
ACS_ENABLED=1
ACS_PROVIDER=ixc-acs
ACS_BASE_URL=https://acs.glcinternet.com.br
ACS_CLIENT_ID=6a179ba2a502f754d0247f4a
ACS_CLIENT_SECRET=***
ACS_MODE=read_only
ACS_TIMEOUT_MS=12000
ACS_AUTH_PATH=/auth
ACS_DEVICE_SEARCH_PATHS=/app/devices/views/natural,/app/devices
```

## Segurança

- `ACS_MODE=read_only` deve permanecer até validação completa.
- A Ficha 360 pode ler dados do ACS, mas não executa ação.
- Alteração de senha Wi-Fi só deve ser liberada futuramente com:
  1. confirmação explícita do cliente;
  2. identificação segura do CPE correto;
  3. auditoria persistente;
  4. permissão por perfil;
  5. webhook/retorno de sucesso ou falha;
  6. rollback/manual fallback.

## Próximos passos

1. Configurar `ACS_CLIENT_SECRET` diretamente no `.env` da produção.
2. Confirmar rota real de autenticação do IXC ACS. O código aceita `ACS_AUTH_PATH` configurável.
3. Testar autenticação.
4. Testar busca de dispositivo por identificadores vindos do IXC.
5. Ajustar mapeamento de campos conforme retorno real da API.
