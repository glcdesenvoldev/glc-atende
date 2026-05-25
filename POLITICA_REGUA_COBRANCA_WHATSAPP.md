# Política — Régua segura de cobrança WhatsApp GLC Atende

Status: planejamento seguro. Envio automático real continua bloqueado até aprovação explícita.

## Régua sugerida

1. **D-5 — 5 dias antes do vencimento**
   - Objetivo: lembrete preventivo.
   - Tom: educado, informativo, sem pressão.
   - Requisito: fatura única segura identificada.

2. **D0 — dia do vencimento**
   - Objetivo: lembrar vencimento no dia.
   - Tom: objetivo e cordial.
   - Requisito: fatura ainda aberta no IXC.

3. **D+3 — 3 dias após vencimento**
   - Objetivo: cobrança leve de pendência.
   - Tom: firme, sem ameaça indevida.
   - Requisito: fatura ainda aberta, cliente não marcado como exceção, sem múltiplas faturas sem conferência.

## Travamentos obrigatórios antes de envio automático

- Não enviar se houver múltiplas faturas abertas sem escolha segura.
- Não enviar fora de horário comercial definido.
- Não enviar para cliente sem telefone válido/WhatsApp confirmado.
- Não enviar se cliente estiver em lista de exceção/manual.
- Não enviar PIX/boleto sem conferir que a fatura segue aberta no IXC.
- Registrar auditoria: cliente ID, fatura ID, etapa da régua, data/hora, resultado e canal.
- Permitir opt-out/remoção da régua quando solicitado.
- Não registrar CPF completo, token, PIX copia-e-cola completo ou linha digitável completa em logs de auditoria geral.

## Situação atual

- Modo permitido: preview interno, resumo, aprovação humana e cópia manual.
- Modo bloqueado: disparo automático para WhatsApp do cliente.
