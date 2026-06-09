# SECURITY_CHECKLIST_GLC

Checklist de seguranca operacional do GLC Atende.

## Escopo

Este documento cobre a operacao atual em VPS Docker com Traefik, Telegram, IXC read-only, Evolution API local e acesso operacional por Tailscale/SSH.

## Tailscale

- Usar Tailscale para acesso administrativo entre VPS/operador e producao.
- Nao expor SSH, painéis internos ou APIs administrativas quando puderem ficar na VPN.
- Revisar periodicamente dispositivos pareados e remover nos inativos.
- Preferir MagicDNS/Tailscale IP para operacao interna.
- Nao publicar IPs internos ou topologia completa em documentos externos.

Status atual: **parcial/funcionando**. Acesso operacional validado por Tailscale/SSH.

## SSH

- `PermitRootLogin no` deve permanecer ativo.
- Acesso operacional deve usar usuario nominal, hoje `openclaw`.
- Chaves temporarias devem ser removidas depois do uso.
- Acesso por senha deve ser evitado no futuro, quando houver plano de contingencia.
- Nunca commitar chave privada, `.pem`, `.key` ou certificados.

Status atual: **bom**, com root SSH bloqueado.

## Sudo do usuario openclaw

- Usar `sudo` apenas para operacoes necessarias de Docker/deploy.
- Registrar comandos sensiveis no historico operacional/relatorio de deploy.
- Nao usar `sudo` para apagar dados, editar `.env`, firewall, DNS ou banco sem aprovacao humana.
- Revisar futuramente se o `sudo` pode ser limitado a comandos especificos.

Status atual: **funcionando, com melhoria recomendada**.

## IXC read-only

- Token IXC deve ficar apenas no `.env` da VPS.
- Usuario API do IXC deve ser de leitura enquanto a fase de escrita nao for aprovada.
- `IXC_WRITE_ENABLED` deve ficar ausente, vazio ou diferente de `1`.
- Funcoes de escrita no codigo devem validar `IXC_WRITE_ENABLED=1`.
- Mesmo com a flag ativa no futuro, escrita IXC deve exigir aprovacao humana e auditoria.

Acoes IXC proibidas sem aprovacao:

- responder ou fechar chamado;
- gerar, alterar ou reenviar boleto pelo IXC;
- baixar titulo/pagamento;
- alterar cliente, contrato, produto, fornecedor ou financeiro.

Status atual: **read-only por padrao**.

## Telegram webhook secret

- `TELEGRAM_WEBHOOK_SECRET` deve estar configurado em producao.
- Em `NODE_ENV=production`, webhook sem secret deve retornar erro e nao processar mensagem.
- IDs de usuarios/grupos devem ficar em variaveis de ambiente.
- Nao manter fallback hardcoded para superusuario.

Status esperado apos esta branch: **corrigido**.

## Evolution webhook secret

- `EVOLUTION_WEBHOOK_SECRET` deve estar configurado antes de expor webhook publicamente.
- Evolution API deve permanecer local ou atras de proxy controlado.
- Envio WhatsApp automatico ao cliente deve ficar bloqueado por flag e aprovacao.
- Webhook de entrada pode registrar/notificar, mas nao deve responder cliente automaticamente sem regra aprovada.

Status atual: **parcial/controlado**.

## MONITOR_SECRET

- `MONITOR_SECRET` protege endpoints internos de diagnostico.
- Deve ser segredo forte e exclusivo.
- Nao deve aparecer em logs, mensagens, README, prints ou ZIP externo.
- Rotas protegidas por `MONITOR_SECRET` devem retornar `401` quando segredo estiver ausente/incorreto.

Decisao atual para `/api/financeiro/diagnostico`:

- Endpoint classificado como **interno por segredo**, nao como endpoint de dashboard por sessao.
- Ele fica fora do proxy de sessao para permitir monitoramento interno controlado por `MONITOR_SECRET`.
- Nao deve retornar dados completos sensiveis sem mascaramento/limite.
- Para uso em dashboard humano no futuro, criar rota separada protegida por sessao.

## Dados financeiros sensiveis

Tratar como sensiveis:

- linha digitavel;
- PIX copia-e-cola;
- links de boleto;
- CPF/CNPJ;
- telefone;
- e-mail;
- valor, vencimento e status financeiro individual.

Regras:

- Evitar enviar dados completos no Telegram.
- Preferir resumo e identificadores internos.
- Registrar auditoria sem expor mais dados que o necessario.
- Revisar acesso ao `DATA_DIR`.

## Retencao de logs

- Logs de aprovacao financeira devem ter retencao curta.
- Logs nao devem guardar segredo, token, chave privada ou payload completo de cliente.
- Criar politica futura de expiracao para aprovacoes antigas.
- Para escala multioperador, migrar persistencia sensivel para banco com controle de acesso e criptografia.

Recomendacao inicial:

- manter historico operacional minimo;
- limpar aprovacoes expiradas;
- mascarar linha digitavel/PIX quando possivel;
- documentar prazo de retencao aprovado pelo CEO.

## LGPD

- Coletar e armazenar apenas dados necessarios para atendimento/financeiro.
- Minimizar dados enviados em Telegram/WhatsApp.
- Definir retencao por finalidade.
- Restringir acesso por perfil.
- Manter auditoria para acoes criticas.
- Evitar enviar dados financeiros por canais sem confirmacao de destinatario.

## Acoes proibidas sem aprovacao humana

- Deploy em producao.
- Reiniciar/parar servicos.
- Alterar `.env`.
- Alterar DNS/firewall.
- Alterar banco/dados de producao.
- Apagar arquivos, volumes, backups ou logs.
- Habilitar envio WhatsApp/e-mail/SMS.
- Habilitar escrita IXC.
- Baixar pagamento/titulo.
- Enviar boleto real ao cliente.
- Comunicar cliente em nome da GLC.

## Riscos restantes

- Historico Git de producao ainda precisa ser reconciliado com branch canonica.
- `sudo` do usuario `openclaw` deve ser revisado para menor privilegio.
- Persistencia em arquivo para aprovacoes financeiras precisa de retencao/criptografia futura.
- Evolution e Telegram dependem de secrets fortes e rotacao periodica.
- Escrita IXC deve permanecer bloqueada ate desenho completo de aprovacao e rollback.

## Checklist antes de aprovar deploy

- [ ] Diff revisado.
- [ ] `.env` nao alterado.
- [ ] Sem segredos no Git.
- [ ] `pnpm exec tsc --noEmit` passou.
- [ ] `pnpm lint` passou.
- [ ] `pnpm build` passou.
- [ ] `IXC_WRITE_ENABLED` nao ativado.
- [ ] WhatsApp automatico nao ativado.
- [ ] Deploy aprovado por humano.
- [ ] Rollback definido.
