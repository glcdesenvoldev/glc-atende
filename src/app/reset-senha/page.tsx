export default async function ResetSenhaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const token = first(params.token);
  const email = first(params.email);
  const enviado = params.enviado;
  const erro = first(params.erro);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-4">
      <section className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-xl">
        <h1 className="text-2xl font-bold">Redefinir senha</h1>
        <p className="text-sm text-slate-400 mt-1">GLC Atende</p>

        {enviado ? <p className="mt-4 rounded-lg bg-green-950/60 border border-green-800 p-3 text-sm">Se o e-mail estiver autorizado, enviamos um link de redefinição.</p> : null}
        {erro === "senha" ? <p className="mt-4 rounded-lg bg-red-950/60 border border-red-800 p-3 text-sm">A senha precisa ter no mínimo 10 caracteres e a confirmação deve bater.</p> : null}
        {erro === "token" ? <p className="mt-4 rounded-lg bg-red-950/60 border border-red-800 p-3 text-sm">Link inválido ou expirado. Solicite outro reset.</p> : null}
        {erro === "email" ? <p className="mt-4 rounded-lg bg-red-950/60 border border-red-800 p-3 text-sm">Não foi possível enviar o e-mail de reset. Verifique a configuração SMTP.</p> : null}

        {token && email ? (
          <form method="post" action="/api/auth/reset-password" className="mt-6 space-y-4">
            <input type="hidden" name="email" value={email} />
            <input type="hidden" name="token" value={token} />
            <label className="block text-sm">
              Nova senha
              <input name="password" type="password" autoComplete="new-password" minLength={10} required className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2" />
            </label>
            <label className="block text-sm">
              Confirmar nova senha
              <input name="confirm" type="password" autoComplete="new-password" minLength={10} required className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2" />
            </label>
            <button className="w-full rounded-lg bg-blue-600 hover:bg-blue-500 px-4 py-2 font-semibold">Salvar nova senha</button>
          </form>
        ) : (
          <form method="post" action="/api/auth/request-password-reset" className="mt-6 space-y-4">
            <label className="block text-sm">
              E-mail autorizado
              <input name="email" type="email" autoComplete="email" required className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2" />
            </label>
            <button className="w-full rounded-lg bg-blue-600 hover:bg-blue-500 px-4 py-2 font-semibold">Enviar link de reset</button>
          </form>
        )}

        <a href="/login" className="block mt-4 text-sm text-blue-300 hover:text-blue-200">Voltar para login</a>
      </section>
    </main>
  );
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
