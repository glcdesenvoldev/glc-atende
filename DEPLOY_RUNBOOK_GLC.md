# DEPLOY_RUNBOOK_GLC

Runbook de deploy do GLC Atende em VPS Docker.

## Branch oficial

Estado atual recomendado:

- Base segura preservada: `prod-srv1541068-snapshot-20260609`
- Branch de trabalho recente: `fase2-reenvio-assistido`
- Branch deste hardening: `hardening-glc-atende-20260609`

Decisao pendente: escolher se `main` volta a ser a branch canonica de producao ou se uma branch `prod` sera criada para refletir o estado real da VPS.

Enquanto houver divergencia entre GitHub `main` e producao, nao executar `git pull` direto em producao. Preferir cherry-pick controlado ou PR revisado.

## Pre-deploy

Antes de qualquer deploy:

1. Confirmar aprovacao humana.
2. Confirmar branch/commit alvo.
3. Conferir `git status --short`.
4. Garantir que nao ha alteracoes locais inesperadas.
5. Rodar validacoes locais.
6. Confirmar que `.env` nao foi alterado.
7. Confirmar que o deploy nao habilita:
   - envio WhatsApp automatico;
   - escrita IXC;
   - baixa financeira;
   - alteracao DNS/firewall.

## Comandos de build/teste

```bash
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit
pnpm lint
pnpm build
```

Em producao, antes do rebuild:

```bash
cd /docker/glc-atende
git status --short
git log --oneline -5
pnpm exec tsc --noEmit
pnpm lint
pnpm build
```

## Comandos permitidos

Com aprovacao para deploy do GLC Atende:

```bash
cd /docker/glc-atende
git fetch origin BRANCH
git cherry-pick COMMIT
pnpm exec tsc --noEmit
pnpm lint
pnpm build
docker compose up -d --build glc-atende
docker ps
curl -sI http://127.0.0.1:3000/api/health
curl -sI http://127.0.0.1:3000/api/ixc/webhook
```

Somente leitura, sem aprovacao adicional:

```bash
hostname
pwd
whoami
date
git status --short
git log --oneline -10
docker ps
docker compose ps
docker logs --tail 100 glc-atende
ss -tulpn
tailscale status
```

## Comandos proibidos sem aprovacao explicita

```bash
docker compose down
docker compose restart
docker system prune
docker volume rm
rm -rf
git reset --hard
git clean -fd
git push --force
iptables / ufw / firewall-cmd
apt install
chmod / chown em massa
mv/remocao de data ou .env
```

## Healthcheck

Health simples, sem IXC:

```bash
curl -sI http://127.0.0.1:3000/api/health
```

Health legado/app:

```bash
curl -sI http://127.0.0.1:3000/api/ixc/webhook
```

Diagnostico financeiro protegido:

```bash
curl -s -o /tmp/diag.out -w "%{http_code}\n" http://127.0.0.1:3000/api/financeiro/diagnostico
```

Resultado esperado sem `MONITOR_SECRET`: `401`.

## Rollback

Rollback seguro deve ser planejado antes do deploy.

Opcoes:

1. Reverter commit com `git revert COMMIT` e rebuild.
2. Cherry-pick de commit anterior conhecido.
3. Usar branch de backup criada antes da mudanca.

Nao usar `git reset --hard` em producao sem aprovacao explicita, porque pode apagar alteracoes locais ou divergencias ainda nao reconciliadas.

Checklist de rollback:

```bash
cd /docker/glc-atende
git log --oneline -5
git branch backup-before-rollback-$(date +%Y%m%d%H%M%S)
git revert COMMIT
pnpm exec tsc --noEmit
pnpm lint
pnpm build
docker compose up -d --build glc-atende
curl -sI http://127.0.0.1:3000/api/health
```

## Aprovacao humana necessaria

Sempre pedir aprovacao antes de:

- deploy em producao;
- rollback;
- parar/reiniciar servico;
- alterar Docker/Traefik;
- alterar DNS/firewall;
- alterar `.env`;
- habilitar envio WhatsApp;
- habilitar escrita IXC;
- mexer em banco/dados;
- apagar arquivos/backups;
- enviar mensagem/e-mail a cliente;
- baixa financeira.

## Instrução de deploy desta branch

Esta branch `hardening-glc-atende-20260609` ainda nao deve ser aplicada em producao sem revisao do diff e aprovacao humana.

Fluxo recomendado:

1. Revisar diff.
2. Aprovar PR/commit.
3. Aplicar em producao por cherry-pick.
4. Rodar validacoes.
5. Rebuild apenas `glc-atende`.
6. Conferir healthcheck.
