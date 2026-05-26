# Política — Régua segura de cobrança WhatsApp GLC Atende

Status: modo backup/contingência. A camada técnica existe, mas envio real para cliente continua bloqueado; no momento a Mundiale segue como canal principal de atendimento/cobrança.

## Responsabilidade por canal

- **E-mail:** permanece a cargo do IXC, por ser a fonte oficial da cobrança, boleto, baixa e histórico financeiro.
- **WhatsApp principal ao cliente:** Mundiale, enquanto continuar trazendo as informações de boleto/fatura corretamente.
- **WhatsApp pelo GLC Atende/Evolution:** somente backup/contingência, com travas de segurança, opt-out, anti-duplicidade e auditoria interna, caso a Mundiale não entregue as informações necessárias.
- **Fonte financeira oficial:** sempre IXC.
- **Auditoria operacional da régua:** GLC Atende.


## Modo operacional atual — backup da Mundiale

- O GLC Atende não deve enviar cobrança ao cliente enquanto a Mundiale estiver operando corretamente.
- O GLC Atende deve funcionar como consulta segura, conferência, auditoria e plano B para casos em que a Mundiale não traga boleto/fatura/dados de pagamento ao cliente.
- Qualquer ativação de envio real pelo GLC Atende exige nova aprovação explícita de Gilson e validação do número definitivo.

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

- Não enviar se o envio real estiver bloqueado por configuração (`BILLING_CADENCE_WHATSAPP_ENABLED` diferente de `1`).
- Não enviar se houver múltiplas faturas abertas sem escolha segura.
- Não enviar fora da etapa D-5, D0 ou D+3.
- Não enviar para cliente sem telefone válido/WhatsApp confirmado.
- Não enviar se cliente estiver em lista de exceção/opt-out/manual.
- Não enviar etapa duplicada para o mesmo cliente + fatura + canal.
- Não enviar PIX/boleto sem conferir que a fatura segue aberta no IXC.
- Registrar auditoria: cliente ID, fatura ID, etapa da régua, data/hora, resultado e canal.
- Permitir opt-out/remoção da régua quando solicitado.
- Não registrar CPF completo, token, PIX copia-e-cola completo ou linha digitável completa em logs de auditoria geral.

## Configuração de liberação futura

- `EVOLUTION_API_URL`: URL da Evolution API.
- `EVOLUTION_API_KEY`: chave da Evolution API.
- `EVOLUTION_INSTANCE`: instância padrão.
- `EVOLUTION_BILLING_INSTANCE`: instância opcional exclusiva para cobrança; se vazia, usa `EVOLUTION_INSTANCE`.
- `BILLING_CADENCE_WHATSAPP_ENABLED=0`: padrão seguro, sem envio real.
- `BILLING_CADENCE_WHATSAPP_ENABLED=1`: só configurar após aprovação explícita de Gilson do número definitivo.

## Situação atual

- Permitido: preview interno, validação de envio bloqueado, dry-run, opt-out/exceções, anti-duplicidade e auditoria.
- Bloqueado: disparo real para WhatsApp do cliente enquanto a Mundiale for o canal principal e até liberação explícita da flag e número definitivo.
- E-mail: manter pelo IXC; o GLC Atende não deve duplicar envio de e-mail nesta fase.
- Uso atual recomendado: backup operacional para consulta/apoio quando a Mundiale não trouxer informações de boleto/fatura.
