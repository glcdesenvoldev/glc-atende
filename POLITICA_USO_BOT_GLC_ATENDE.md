# Política de Uso do Bot GLC Atende

## Objetivo
Controlar o uso do bot interno para consulta operacional de clientes, chamados e faturas, com rastreabilidade, segurança e conformidade com a LGPD.

## Princípios
- **Finalidade:** usar dados apenas para atendimento, suporte, cobrança autorizada e operação da GLC.
- **Necessidade / menor privilégio:** cada usuário acessa somente o necessário para sua função.
- **Segurança e prevenção:** acesso restrito por usuário, grupo, horário e comandos permitidos.
- **Auditoria:** consultas devem ser rastreáveis por usuário, horário, canal e tipo de ação.

## Perfis atuais

### Administrador — Gilson
- Acesso privado e grupo.
- Horário livre, inclusive urgências.
- Pode receber alertas e resumo diário.

### Operador — Olindo
- Acesso somente pelo grupo autorizado.
- Horário permitido: segunda a sexta, 08:00 às 18:00, horário de Brasília.
- Sábado, domingo e fora do horário: bloqueado, salvo liberação futura do Gilson.
- Deve usar o bot somente para demanda operacional real.

## Regras de uso
1. Proibido consultar cliente sem motivo operacional.
2. Proibido compartilhar dados de cliente fora dos canais autorizados.
3. PIX e boleto seguem bloqueados para automação direta até validação de permissões.
4. Consulta fora do horário deve ser tratada como exceção e passar por Gilson.
5. Funcionário desligado ou sem função operacional deve perder acesso imediatamente.
6. Todas as consultas devem gerar log com usuário, horário, canal, comando, termo pesquisado, status e IDs retornados, sem salvar dados completos do cliente no log.

## Padrão de comando
- Privado do Gilson: enviar ID, telefone ou nome diretamente.
- Grupo: usar `/c termo` ou `/cliente termo`.

## Auditoria atual
O bot grava logs persistentes em JSONL no servidor:

`/docker/glc-atende/data/audit/telegram-audit.jsonl`

Campos principais: data/hora, usuário Telegram, chat, tipo de chat, ação, tipo da consulta, status, quantidade e IDs retornados. Não grava nome, telefone ou termo bruto pesquisado.

## Próxima evolução recomendada
Criar resumo diário automático, tela de auditoria no painel e alertas por uso anômalo.

## Resumo diário
O servidor envia automaticamente para Gilson um resumo diário de auditoria às 18:05, horário de Brasília, de segunda a sexta.

O resumo inclui totais por usuário, ação, consultas não encontradas e bloqueios, sem dados completos de clientes.

Script: `/docker/glc-atende/scripts/telegram-audit-summary.js`
Agendamento: cron do servidor, 21:05 UTC / 18:05 BRT.
