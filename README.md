# GLC Atende

Painel inicial de atendimento da GLC Internet, com leitura de chamados do IXC Soft e webhook para notificação via Evolution API/WhatsApp.

## Variáveis de ambiente

Copie `.env.example` e configure os valores reais no ambiente local/Railway:

```bash
cp .env.example .env.local
```

Obrigatórias para IXC real:

- `IXC_URL`
- `IXC_TOKEN`

Obrigatórias para disparo via WhatsApp:

- `EVOLUTION_API_URL`
- `EVOLUTION_API_KEY`
- `EVOLUTION_INSTANCE`
- `TELEFONE_GILSON`

Sem `IXC_TOKEN`, o painel usa dados mockados para desenvolvimento. Sem credenciais completas da Evolution API, o webhook apenas registra a mensagem no log e não envia WhatsApp.

⚠️ Não commitar `.env`, tokens, senhas ou chaves.

## Healthcheck Railway

O Railway usa:

```txt
/api/ixc/webhook
```

O método `GET` desta rota retorna status 200 para healthcheck. O IXC deve chamar a mesma rota via `POST`.

## Desenvolvimento local

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
