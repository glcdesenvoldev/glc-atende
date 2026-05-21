"use client";

import { useState, useEffect, useCallback } from "react";
import { Headphones, RefreshCw, AlertCircle, Clock, CheckCircle2, Loader2, User, ChevronDown, ChevronUp, Send, LogOut } from "lucide-react";

interface Chamado {
  id: string;
  assunto: string;
  descricao: string;
  status: string;
  prioridade: string;
  nome_cliente: string;
  data_abertura: string;
  data_update: string;
}

const prioConfig: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  A: { label: "Urgente",  cls: "bg-rose-500/10 text-rose-400 border-rose-500/20",     icon: <AlertCircle className="w-3 h-3" /> },
  M: { label: "Médio",    cls: "bg-amber-500/10 text-amber-400 border-amber-500/20",  icon: <Clock className="w-3 h-3" /> },
  B: { label: "Baixo",    cls: "bg-sky-500/10 text-sky-400 border-sky-500/20",        icon: <CheckCircle2 className="w-3 h-3" /> },
};

function timeAgo(dateStr: string, now: number): string {
  const diff = now - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "agora";
  if (mins < 60) return `${mins}min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

export default function ChamadosPage() {
  const [chamados,  setChamados]  = useState<Chamado[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [ixcUnavailable, setIxcUnavailable] = useState(false);
  const [expanded,  setExpanded]  = useState<string | null>(null);
  const [resposta,  setResposta]  = useState<Record<string, string>>({});
  const [sending,   setSending]   = useState<string | null>(null);
  const [filtro,    setFiltro]    = useState("todos");
  const [lastUpdate, setLastUpdate] = useState(new Date().toLocaleTimeString("pt-BR"));
  const [now, setNow] = useState(() => Date.now());

  const fetch_ = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/chamados");
      if (res.ok) {
        const data = await res.json();
        setIxcUnavailable(Boolean(data.unavailable));
        setChamados(Array.isArray(data.items) ? data.items : []);
      } else {
        setIxcUnavailable(true);
        setChamados([]);
      }
    } catch {
      setIxcUnavailable(true);
      setChamados([]);
    }
    setLoading(false);
    setLastUpdate(new Date().toLocaleTimeString("pt-BR"));
  }, []);

  useEffect(() => {
    const t = setTimeout(fetch_, 0);
    const iv = setInterval(fetch_, 60000);
    return () => {
      clearTimeout(t);
      clearInterval(iv);
    };
  }, [fetch_]);

  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(iv);
  }, []);

  const handleResponder = async (id: string) => {
    if (!resposta[id]?.trim()) return;
    setSending(id);
    await new Promise(r => setTimeout(r, 800));
    setChamados(prev => prev.map(c => c.id === id ? { ...c, data_update: new Date().toISOString() } : c));
    setResposta(prev => ({ ...prev, [id]: "" }));
    setSending(null);
  };

  const handleDirecionar = (c: Chamado) => {
    alert(`Chamado #${c.id} de ${c.nome_cliente} direcionado para Olindo!\n\nEle receberá notificação no WhatsApp.`);
  };

  const filtered = chamados.filter(c => filtro === "todos" || c.prioridade === filtro);
  const urgentes = chamados.filter(c => c.prioridade === "A").length;

  return (
    <div className="p-6 space-y-6 min-h-screen bg-[#0D1B2A]">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Headphones className="w-6 h-6 text-[#14B8A6]" />
            Chamados GLC Internet
          </h1>
          <p className="text-[#94A3B8] text-sm mt-0.5">
            {ixcUnavailable ? "IXC indisponível" : `${chamados.length} abertos`} · {urgentes > 0 ? `⚠️ ${urgentes} urgente${urgentes > 1 ? "s" : ""}` : "✅ sem urgências"} · atualizado {lastUpdate}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-[#1E3050] border border-[#2A4060] rounded-xl p-1 gap-1">
            {["todos","A","M","B"].map(f => (
              <button key={f} onClick={() => setFiltro(f)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${filtro === f ? "bg-[#F97316] text-white" : "text-[#94A3B8] hover:text-white"}`}>
                {f === "todos" ? "Todos" : f === "A" ? "🔴 Urgente" : f === "M" ? "🟡 Médio" : "🟢 Baixo"}
              </button>
            ))}
          </div>
          <button onClick={fetch_} disabled={loading}
            className="flex items-center gap-1.5 bg-[#1E3050] border border-[#2A4060] hover:border-[#14B8A6]/40 text-[#94A3B8] hover:text-white rounded-xl px-3 py-2 text-xs transition-all">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </button>
          <form method="post" action="/api/auth/logout">
            <button type="submit"
              className="flex items-center gap-1.5 bg-rose-500/10 border border-rose-500/20 hover:bg-rose-500/20 text-rose-300 hover:text-rose-200 rounded-xl px-3 py-2 text-xs transition-all">
              <LogOut className="w-3.5 h-3.5" />
              Sair
            </button>
          </form>
        </div>
      </div>

      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="bg-[#1E3050] rounded-2xl border border-[#2A4060] p-10 text-center">
            {ixcUnavailable ? (
              <>
                <AlertCircle className="w-10 h-10 text-amber-400 mx-auto mb-3" />
                <p className="text-white font-medium">IXC indisponível ou sem resposta agora.</p>
                <p className="text-[#94A3B8] text-sm mt-1">Nenhum dado de exemplo é exibido em produção para evitar chamados fantasmas.</p>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-10 h-10 text-[#14B8A6] mx-auto mb-3" />
                <p className="text-[#94A3B8]">Nenhum chamado aberto nesta categoria 🎉</p>
              </>
            )}
          </div>
        ) : filtered.map(c => {
          const prio = prioConfig[c.prioridade] || prioConfig.M;
          const isOpen = expanded === c.id;
          const mins = Math.floor((now - new Date(c.data_abertura).getTime()) / 60000);

          return (
            <div key={c.id} className={`bg-[#1E3050] rounded-2xl border transition-all ${
              c.prioridade === "A" ? "border-rose-500/30" : "border-[#2A4060] hover:border-[#2A4060]/80"
            }`}>
              <button onClick={() => setExpanded(isOpen ? null : c.id)}
                className="w-full text-left p-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border font-medium shrink-0 ${prio.cls}`}>
                    {prio.icon}{prio.label}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white truncate">
                      #{c.id} — {c.assunto}
                    </p>
                    <p className="text-xs text-[#94A3B8] flex items-center gap-1.5 mt-0.5">
                      <User className="w-3 h-3" />{c.nome_cliente}
                      <span className="text-[#2A4060]">·</span>
                      <Clock className="w-3 h-3" />
                      <span className={mins > 60 ? "text-rose-400 font-medium" : ""}>{timeAgo(c.data_abertura, now)}</span>
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={e => { e.stopPropagation(); handleDirecionar(c); }}
                    className="text-xs bg-[#14B8A6]/10 hover:bg-[#14B8A6]/20 border border-[#14B8A6]/20 text-[#14B8A6] px-3 py-1.5 rounded-xl transition-colors">
                    → Olindo
                  </button>
                  {isOpen ? <ChevronUp className="w-4 h-4 text-[#94A3B8]" /> : <ChevronDown className="w-4 h-4 text-[#94A3B8]" />}
                </div>
              </button>

              {isOpen && (
                <div className="px-4 pb-4 pt-0 space-y-3 border-t border-[#2A4060]">
                  <div className="bg-[#0F2744] rounded-xl p-3 text-sm text-[#94A3B8] mt-3">
                    {c.descricao}
                  </div>
                  <div className="flex gap-3">
                    <input value={resposta[c.id] || ""} onChange={e => setResposta(p => ({ ...p, [c.id]: e.target.value }))}
                      placeholder="Digite a resposta para o cliente..."
                      onKeyDown={e => e.key === "Enter" && handleResponder(c.id)}
                      className="flex-1 bg-[#0F2744] border border-[#2A4060] rounded-xl px-3 py-2.5 text-sm text-white placeholder-[#94A3B8]/50 focus:outline-none focus:border-[#14B8A6] transition-colors" />
                    <button onClick={() => handleResponder(c.id)} disabled={!resposta[c.id]?.trim() || sending === c.id}
                      className="bg-[#F97316] hover:bg-[#ea6c0c] disabled:opacity-40 text-white rounded-xl px-4 py-2.5 transition-all flex items-center gap-2">
                      {sending === c.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
