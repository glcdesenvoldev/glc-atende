export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const erro = params.erro;
  const reset = params.reset;

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-4">
      <section className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-xl">
        <h1 className="text-2xl font-bold">GLC Atende</h1>
        <p className="text-sm text-slate-400 mt-1">Acesso interno</p>

        {erro ? <p className="mt-4 rounded-lg bg-red-950/60 border border-red-800 p-3 text-sm">Usuário ou senha inválidos.</p> : null}
        {reset ? <p className="mt-4 rounded-lg bg-green-950/60 border border-green-800 p-3 text-sm">Senha redefinida. Entre com a nova senha.</p> : null}

        <form method="post" action="/api/auth/login" className="mt-6 space-y-4">
          <label className="block text-sm">
            Usuário
            <input name="username" autoComplete="username" required className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2" />
          </label>
          <label className="block text-sm">
            Senha
            <input name="password" type="password" autoComplete="current-password" required className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2" />
          </label>
          <button className="w-full rounded-lg bg-blue-600 hover:bg-blue-500 px-4 py-2 font-semibold">Entrar</button>
        </form>

        <a href="/reset-senha" className="block mt-4 text-sm text-blue-300 hover:text-blue-200">Esqueci minha senha</a>
      </section>
    </main>
  );
}
