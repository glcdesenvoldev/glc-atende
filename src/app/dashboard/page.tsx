import Link from "next/link";
import { CircleDollarSign, Headphones, LayoutDashboard, ShieldCheck } from "lucide-react";

const cards = [
  {
    href: "/dashboard/chamados",
    title: "Chamados",
    description: "Acompanhar chamados abertos do IXC, prioridades e atendimento interno.",
    icon: Headphones,
    tone: "teal",
    badge: "Operação",
  },
  {
    href: "/dashboard/financeiro",
    title: "Financeiro Seguro",
    description: "Consultar faturas, aprovações internas, auditoria financeira e mensagens manuais.",
    icon: CircleDollarSign,
    tone: "emerald",
    badge: "Seguro",
  },
];

export default function DashboardPage() {
  return (
    <main className="min-h-screen bg-[#0D1B2A] p-6 text-white space-y-6">
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <LayoutDashboard className="w-7 h-7 text-[#14B8A6]" />
          <h1 className="text-2xl font-bold">Dashboard GLC Atende</h1>
        </div>
        <p className="text-sm text-[#94A3B8] max-w-3xl">
          Central interna para acessar os painéis operacionais. Nenhuma ação financeira ou envio externo é executado automaticamente por esta tela.
        </p>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {cards.map((card) => {
          const Icon = card.icon;
          const toneClass = card.tone === "emerald"
            ? "border-emerald-500/20 hover:border-emerald-400/50 text-emerald-300 bg-emerald-500/10"
            : "border-[#14B8A6]/20 hover:border-[#14B8A6]/50 text-[#14B8A6] bg-[#14B8A6]/10";

          return (
            <Link key={card.href} href={card.href}
              className={`bg-[#1E3050] border ${toneClass.split(" ").slice(0, 2).join(" ")} rounded-2xl p-5 transition-all group`}>
              <div className="flex items-start gap-4">
                <div className={`rounded-xl border p-3 ${toneClass}`}>
                  <Icon className="w-6 h-6" />
                </div>
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold group-hover:text-white">{card.title}</h2>
                    <span className="rounded-full bg-[#0F2744] border border-[#2A4060] px-2 py-0.5 text-[11px] text-[#94A3B8]">{card.badge}</span>
                  </div>
                  <p className="text-sm text-[#94A3B8]">{card.description}</p>
                  <p className="text-xs text-[#14B8A6]">Abrir painel →</p>
                </div>
              </div>
            </Link>
          );
        })}
      </section>

      <section className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 flex gap-3 text-sm text-amber-100">
        <ShieldCheck className="w-5 h-5 shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold">Modo seguro ativo</p>
          <p className="text-amber-100/80 mt-1">Envio de boleto/PIX, baixa no IXC, desbloqueio, alteração de cliente e mensagens externas continuam bloqueados sem aprovação humana explícita.</p>
        </div>
      </section>
    </main>
  );
}
