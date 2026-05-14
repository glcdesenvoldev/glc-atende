# Deploy VPS — GLC Atende

Arquitetura recomendada para produção própria:

```txt
Internet
  ↓ HTTPS
Caddy/Nginx Proxy Manager/Coolify Proxy
  ↓ localhost
GLC Atende container → 127.0.0.1:3000
```

## 1. Requisitos da VPS

- Ubuntu 24.04 ou similar
- Docker + Docker Compose plugin
- Firewall liberando somente 22, 80 e 443 publicamente
- Acesso administrativo via SSH/Tailscale

## 2. Variáveis de ambiente

Criar `.env` a partir de `.env.example`:

```bash
cp .env.example .env
nano .env
```

Obrigatórias para produção real:

```env
IXC_URL=https://ixc.glcinternet.com.br/webservice/v1
IXC_TOKEN=COLOCAR_TOKEN_REAL
EVOLUTION_API_URL=COLOCAR_URL_REAL
EVOLUTION_API_KEY=COLOCAR_CHAVE_REAL
EVOLUTION_INSTANCE=glc
TELEFONE_GILSON=5511SEUNUMERO
TELEFONE_OLINDO=5511NUMEROOLINDO
NEXT_PUBLIC_APP_URL=https://atende.glcinternet.com.br
PORT=3000
NODE_ENV=production
```

⚠️ Nunca commitar `.env`.

## 3. Subir com Docker Compose

```bash
docker compose up -d --build
docker compose ps
docker logs -f glc-atende
```

## 4. Validar localmente na VPS

```bash
curl -fsS http://127.0.0.1:3000/api/ixc/webhook
curl -I http://127.0.0.1:3000/dashboard/chamados
```

Resultado esperado:

```txt
/api/ixc/webhook → 200 OK
/dashboard/chamados → 200 OK
```

## 5. Publicação HTTPS

Opção recomendada se não usar Coolify: Caddy.

```bash
apt update
apt install -y caddy
```

Copiar `Caddyfile.example` para `/etc/caddy/Caddyfile`, ajustar domínio e recarregar:

```bash
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
```

## 6. DNS

No provedor DNS, apontar:

```txt
A  glcatende  IP_PUBLICO_DA_VPS
```

## 7. Segurança mínima

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

Não publicar a porta 3000 diretamente. O compose prende em `127.0.0.1:3000`.
