"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleDollarSign, Copy, FileWarning, Loader2, Lock, RefreshCw, Search, ShieldCheck, XCircle } from "lucide-react";

type Status = "segura" | "multiplas" | "sem_fatura" | "indisponivel";

type FaturaResumo = {
  id: string;
  valor: string;
  data_vencimento: string;
  status: string;
};

type FaturaDetalhe = FaturaResumo & {
  id_cliente: string;
  data_emissao: string;
  has_linha_digitavel: boolean;
  has_pix: boolean;
  has_link: boolean;
  linha_digitavel: string;
  pix_copia_cola: string;
  pix_txid: string;
  link: string;
};

type FinanceiroItem = {
  idCliente: string;
  status: Status;
  total: number;
  bloqueio: string | null;
  fatura?: FaturaDetalhe;
  faturas?: FaturaResumo[];
};

type FinanceiroResponse = {
  ok: boolean;
  totalClientes: number;
  resumo: Record<Status, number>;
  items: FinanceiroItem[];
  error?: string;
};

type AprovacaoEnvio = {
  id: string;
  status: "pending" | "approved" | "rejected" | "manual_sent";
  idCliente: string;
  faturaId: string;
  valor: string;
  dataVencimento: string;
  hasLinhaDigitavel: boolean;
  hasPix: boolean;
  hasLink: boolean;
  linhaDigitavel?: string;
  pixCopiaCola?: string;
  link?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  decidedBy?: string;
  note?: string;
  safetyMessage: string;
};

type ClienteBusca = {
  id: string;
  nome: string;
  status: string;
  bairro: string;
  cidade: string;
  telefone_final: string;
};

const statusConfig: Record<Status, { label: string; cls: string; icon: React.ReactNode }> = {
  segura: { label: "Fatura segura", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300", icon: <ShieldCheck className="w-4 h-4" /> },
  multiplas: { label: "Bloqueado: múltiplas", cls: "border-amber-500/30 bg-amber-500/10 text-amber-300", icon: <FileWarning className="w-4 h-4" /> },
  sem_fatura: { label: "Sem fatura aberta", cls: "border-sky-500/30 bg-sky-500/10 text-sky-300", icon: <CheckCircle2 className="w-4 h-4" /> },
  indisponivel: { label: "IXC indisponível", cls: "border-rose-500/30 bg-rose-500/10 text-rose-300", icon: <XCircle className="w-4 h-4" /> },
};

export default function FinanceiroPage() {
  const [ids, setIds] = useState("");
  const [buscaCliente, setBuscaCliente] = useState("");
  const [clientes, setClientes] = useState<ClienteBusca[]>([]);
  const [loadingBusca, setLoadingBusca] = useState(false);
  const [erroBusca, setErroBusca] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<FinanceiroResponse | null>(null);
  const [aprovacoes, setAprovacoes] = useState<AprovacaoEnvio[]>([]);
  const [approvalMsg, setApprovalMsg] = useState("");
  const [approvalNotes, setApprovalNotes] = useState<Record<string, string>>({});
  const [approvalFilter, setApprovalFilter] = useState<"all" | AprovacaoEnvio["status"]>("all");
  const [approvalSearch, setApprovalSearch] = useState("");

  const cleanIds = useMemo(() => ids.split(/[\s,;]+/).map((id) => id.trim()).filter(Boolean), [ids]);
  const approvalCounts = useMemo(() => countApprovals(aprovacoes), [aprovacoes]);
  const filteredApprovals = useMemo(() => filterApprovals(aprovacoes, approvalFilter, approvalSearch), [aprovacoes, approvalFilter, approvalSearch]);

  useEffect(() => {
    carregarAprovacoes();
  }, []);

  async function carregarAprovacoes() {
    const res = await fetch("/api/financeiro/aprovacoes");
    if (!res.ok) return;
    const json = await res.json();
    if (json.ok) setAprovacoes(json.items || []);
  }

  async function decidirAprovacao(id: string, action: "approve" | "reject" | "manual_sent") {
    setApprovalMsg("");
    const note = approvalNotes[id] || "";
    const res = await fetch("/api/financeiro/aprovacoes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action, note }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      setApprovalMsg(json.error || "Falha ao atualizar aprovação.");
      return;
    }
    setApprovalMsg(action === "manual_sent" ? "Envio manual registrado. Nenhuma mensagem foi enviada automaticamente." : "Status atualizado. Nenhuma mensagem foi enviada ao cliente.");
    setApprovalNotes((current) => ({ ...current, [id]: "" }));
    await carregarAprovacoes();
  }

  async function buscarClientes() {
    setLoadingBusca(true);
    setErroBusca("");
    setClientes([]);
    try {
      const res = await fetch(`/api/financeiro/clientes?q=${encodeURIComponent(buscaCliente)}`);
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Falha ao buscar clientes.");
      setClientes(json.items || []);
    } catch (err) {
      setErroBusca(err instanceof Error ? err.message : "Falha ao buscar clientes.");
    } finally {
      setLoadingBusca(false);
    }
  }

  function adicionarCliente(id: string) {
    const atuais = new Set(ids.split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean));
    atuais.add(id);
    setIds(Array.from(atuais).join("\n"));
  }

  async function consultar() {
    setLoading(true);
    setError("");
    setData(null);
    try {
      const res = await fetch(`/api/financeiro/faturas?ids=${encodeURIComponent(ids)}`);
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Falha ao consultar financeiro.");
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao consultar financeiro.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0D1B2A] p-6 text-white space-y-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <CircleDollarSign className="w-7 h-7 text-[#14B8A6]" />
          <h1 className="text-2xl font-bold">Financeiro Seguro — GLC Atende</h1>
        </div>
        <p className="text-sm text-[#94A3B8] max-w-3xl">
          Consulta interna para validar fatura única antes de qualquer boleto/PIX. Esta tela não envia mensagem para cliente e bloqueia casos com múltiplas faturas.
        </p>
      </header>

      <section className="bg-[#1E3050] border border-[#2A4060] rounded-2xl p-5 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Buscar cliente no IXC</h2>
          <p className="text-xs text-[#94A3B8] mt-1">Use nome, telefone ou ID. A busca mostra dados mínimos para reduzir exposição.</p>
        </div>
        <div className="flex flex-col md:flex-row gap-3">
          <input
            value={buscaCliente}
            onChange={(e) => setBuscaCliente(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && buscaCliente.trim()) buscarClientes(); }}
            placeholder="Ex.: Maria, 11999999999 ou 12345"
            className="flex-1 rounded-xl bg-[#0F2744] border border-[#2A4060] px-4 py-3 text-sm text-white placeholder-[#94A3B8]/60 focus:outline-none focus:border-[#14B8A6]"
          />
          <button
            onClick={buscarClientes}
            disabled={loadingBusca || !buscaCliente.trim()}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#14B8A6] hover:bg-[#0f9f90] disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2 text-sm font-semibold"
          >
            {loadingBusca ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Buscar cliente
          </button>
        </div>
        {erroBusca && (
          <div className="flex items-center gap-2 text-rose-200 bg-rose-500/10 border border-rose-500/20 rounded-xl p-3 text-sm">
            <AlertTriangle className="w-4 h-4" /> {erroBusca}
          </div>
        )}
        {clientes.length > 0 && (
          <div className="space-y-2">
            {clientes.map((cliente) => (
              <div key={cliente.id} className="flex flex-col md:flex-row md:items-center justify-between gap-3 rounded-xl bg-[#0F2744] border border-[#2A4060] p-3">
                <div className="text-sm">
                  <p className="font-semibold">#{cliente.id} — {cliente.nome}</p>
                  <p className="text-xs text-[#94A3B8]">Status: {cliente.status || "-"} • {cliente.bairro || "bairro -"} / {cliente.cidade || "cidade -"} {cliente.telefone_final ? `• Tel. ${cliente.telefone_final}` : ""}</p>
                </div>
                <button
                  onClick={() => adicionarCliente(cliente.id)}
                  className="rounded-lg bg-[#F97316] px-3 py-2 text-xs font-semibold hover:bg-[#ea6c0c]"
                >
                  Adicionar à consulta financeira
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="bg-[#1E3050] border border-[#2A4060] rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-2 text-amber-200 text-sm bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
          <Lock className="w-4 h-4 shrink-0" />
          <span>Modo seguro: envio externo, baixa financeira, renegociação e alteração no IXC continuam bloqueados sem aprovação humana.</span>
        </div>
        <label className="block text-sm font-medium text-[#CBD5E1]">
          IDs dos clientes
          <textarea
            value={ids}
            onChange={(e) => setIds(e.target.value)}
            placeholder="Ex.: 12345, 67890 ou um ID por linha"
            className="mt-2 min-h-28 w-full rounded-xl bg-[#0F2744] border border-[#2A4060] px-4 py-3 text-sm text-white placeholder-[#94A3B8]/60 focus:outline-none focus:border-[#14B8A6]"
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={consultar}
            disabled={loading || cleanIds.length === 0}
            className="inline-flex items-center gap-2 rounded-xl bg-[#F97316] hover:bg-[#ea6c0c] disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2 text-sm font-semibold"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Consultar faturas
          </button>
          <button
            onClick={() => { setIds(""); setData(null); setError(""); }}
            className="inline-flex items-center gap-2 rounded-xl bg-[#0F2744] border border-[#2A4060] px-4 py-2 text-sm text-[#CBD5E1] hover:text-white"
          >
            <RefreshCw className="w-4 h-4" />
            Limpar
          </button>
          <span className="text-xs text-[#94A3B8]">Limite: 20 clientes por consulta.</span>
        </div>
        {error && (
          <div className="flex items-center gap-2 text-rose-200 bg-rose-500/10 border border-rose-500/20 rounded-xl p-3 text-sm">
            <AlertTriangle className="w-4 h-4" /> {error}
          </div>
        )}
      </section>

      {data && (
        <>
          <section className="grid grid-cols-1 md:grid-cols-4 gap-3">
            {(Object.keys(statusConfig) as Status[]).map((status) => (
              <div key={status} className={`rounded-2xl border p-4 ${statusConfig[status].cls}`}>
                <div className="flex items-center gap-2 text-sm">{statusConfig[status].icon}{statusConfig[status].label}</div>
                <div className="text-3xl font-bold mt-2">{data.resumo?.[status] || 0}</div>
              </div>
            ))}
          </section>

          <section className="space-y-3">
            {data.items.map((item) => (
              <FinanceiroCard key={item.idCliente} item={item} onApprovalCreated={carregarAprovacoes} />
            ))}
          </section>
        </>
      )}
      <section className="bg-[#1E3050] border border-[#2A4060] rounded-2xl p-5 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Solicitações internas de envio</h2>
          <p className="text-xs text-[#94A3B8] mt-1">Aprovação apenas interna nesta fase. O sistema ainda não envia WhatsApp para cliente.</p>
        </div>
        {approvalMsg ? <div className="rounded-xl bg-[#0F2744] border border-[#2A4060] p-3 text-sm text-amber-200">{approvalMsg}</div> : null}
        {aprovacoes.length > 0 ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <ApprovalFilterButton active={approvalFilter === "all"} onClick={() => setApprovalFilter("all")} label="Todas" count={aprovacoes.length} />
              <ApprovalFilterButton active={approvalFilter === "pending"} onClick={() => setApprovalFilter("pending")} label="Pendentes" count={approvalCounts.pending} />
              <ApprovalFilterButton active={approvalFilter === "approved"} onClick={() => setApprovalFilter("approved")} label="Aprovadas" count={approvalCounts.approved} />
              <ApprovalFilterButton active={approvalFilter === "manual_sent"} onClick={() => setApprovalFilter("manual_sent")} label="Enviadas manualmente" count={approvalCounts.manual_sent} />
              <ApprovalFilterButton active={approvalFilter === "rejected"} onClick={() => setApprovalFilter("rejected")} label="Rejeitadas" count={approvalCounts.rejected} />
            </div>
            <div className="flex flex-col md:flex-row gap-2">
              <input
                value={approvalSearch}
                onChange={(e) => setApprovalSearch(e.target.value)}
                placeholder="Buscar por cliente, fatura, protocolo ou observação"
                className="flex-1 rounded-xl bg-[#0F2744] border border-[#2A4060] px-4 py-2 text-sm text-white placeholder-[#94A3B8]/60 focus:outline-none focus:border-[#14B8A6]"
              />
              {approvalSearch ? (
                <button onClick={() => setApprovalSearch("")} className="rounded-xl bg-[#0F2744] border border-[#2A4060] px-4 py-2 text-xs text-[#CBD5E1] hover:text-white">Limpar busca</button>
              ) : null}
            </div>
          </div>
        ) : null}
        {aprovacoes.length === 0 ? (
          <p className="text-sm text-[#94A3B8]">Nenhuma solicitação registrada ainda.</p>
        ) : filteredApprovals.length === 0 ? (
          <p className="text-sm text-[#94A3B8]">Nenhuma solicitação neste filtro.</p>
        ) : (
          <div className="space-y-2">
            {filteredApprovals.slice(0, 10).map((aprovacao) => (
              <div key={aprovacao.id} className="rounded-xl bg-[#0F2744] border border-[#2A4060] p-3 text-sm space-y-2">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold">Cliente #{aprovacao.idCliente} • Fatura #{aprovacao.faturaId} • R$ {aprovacao.valor || "-"}</p>
                    <p className="text-xs text-[#94A3B8]">Status: {statusAprovacao(aprovacao.status)} • Criada em {formatDate(aprovacao.createdAt)}</p>
                    <p className="text-xs text-[#94A3B8]">Criado por: {aprovacao.createdBy || "dashboard"}{aprovacao.decidedBy ? ` • Última decisão: ${aprovacao.decidedBy}` : ""}</p>
                  </div>
                  {aprovacao.status === "pending" ? (
                    <div className="flex gap-2">
                      <button onClick={() => decidirAprovacao(aprovacao.id, "approve")} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold hover:bg-emerald-500">Aprovar internamente</button>
                      <button onClick={() => decidirAprovacao(aprovacao.id, "reject")} className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold hover:bg-rose-500">Rejeitar</button>
                    </div>
                  ) : aprovacao.status === "approved" ? (
                    <button onClick={() => decidirAprovacao(aprovacao.id, "manual_sent")} className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-semibold hover:bg-sky-500">Marcar enviado manualmente</button>
                  ) : null}
                </div>
                {aprovacao.status === "pending" || aprovacao.status === "approved" ? (
                  <label className="block text-xs text-[#CBD5E1] space-y-1">
                    <span>Observação interna da decisão/envio manual</span>
                    <textarea
                      value={approvalNotes[aprovacao.id] || ""}
                      onChange={(e) => setApprovalNotes((current) => ({ ...current, [aprovacao.id]: e.target.value }))}
                      placeholder="Ex.: conferido no IXC, cliente pediu pelo WhatsApp, enviado manualmente às 14:20..."
                      className="min-h-16 w-full rounded-lg bg-[#0D1B2A] border border-[#2A4060] px-3 py-2 text-xs text-white placeholder-[#94A3B8]/60 focus:outline-none focus:border-[#14B8A6]"
                    />
                  </label>
                ) : null}
                {aprovacao.note ? (
                  <div className="rounded-lg bg-[#0D1B2A] border border-[#2A4060] p-2 text-xs text-[#CBD5E1]">
                    <span className="text-[#94A3B8]">Observação registrada: </span>{aprovacao.note}
                  </div>
                ) : null}
                {aprovacao.status === "approved" || aprovacao.status === "manual_sent" ? (
                  <CopyBlock label="Mensagem aprovada para envio manual" value={mensagemClienteAprovacao(aprovacao)} />
                ) : null}
                <p className="text-xs text-amber-200">{aprovacao.safetyMessage}</p>
              </div>
            ))}
          </div>
        )}
      </section>

    </div>
  );
}



function filterApprovals(aprovacoes: AprovacaoEnvio[], status: "all" | AprovacaoEnvio["status"], search: string) {
  const clean = search.trim().toLowerCase();
  return aprovacoes.filter((aprovacao) => {
    if (status !== "all" && aprovacao.status !== status) return false;
    if (!clean) return true;

    const haystack = [
      aprovacao.id,
      aprovacao.id.slice(0, 8),
      aprovacao.idCliente,
      aprovacao.faturaId,
      aprovacao.valor,
      aprovacao.dataVencimento,
      aprovacao.status,
      aprovacao.createdBy,
      aprovacao.decidedBy || "",
      aprovacao.note || "",
    ].join(" ").toLowerCase();

    return haystack.includes(clean);
  });
}

function countApprovals(aprovacoes: AprovacaoEnvio[]) {
  return aprovacoes.reduce<Record<AprovacaoEnvio["status"], number>>((acc, aprovacao) => {
    acc[aprovacao.status] += 1;
    return acc;
  }, { pending: 0, approved: 0, rejected: 0, manual_sent: 0 });
}

function ApprovalFilterButton({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-semibold ${active ? "border-[#14B8A6] bg-[#14B8A6]/20 text-[#5EEAD4]" : "border-[#2A4060] bg-[#0F2744] text-[#CBD5E1] hover:text-white"}`}
    >
      {label}: {count}
    </button>
  );
}

function FinanceiroCard({ item, onApprovalCreated }: { item: FinanceiroItem; onApprovalCreated: () => void }) {
  const cfg = statusConfig[item.status];
  return (
    <div className="bg-[#1E3050] border border-[#2A4060] rounded-2xl p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-[#94A3B8]">Cliente ID</p>
          <p className="text-lg font-bold">{item.idCliente}</p>
        </div>
        <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${cfg.cls}`}>
          {cfg.icon}{cfg.label}
        </div>
      </div>

      {item.status === "segura" && item.fatura ? <FaturaSegura idCliente={item.idCliente} fatura={item.fatura} onApprovalCreated={onApprovalCreated} /> : null}

      {item.bloqueio ? (
        <div className="rounded-xl bg-[#0F2744] border border-[#2A4060] p-3 text-sm text-[#CBD5E1]">
          <p className="font-semibold text-amber-200">{item.bloqueio}</p>
          {item.faturas?.length ? (
            <div className="mt-3 space-y-2">
              {item.faturas.map((fatura) => <FaturaResumoView key={fatura.id} fatura={fatura} />)}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function FaturaSegura({ idCliente, fatura, onApprovalCreated }: { idCliente: string; fatura: FaturaDetalhe; onApprovalCreated: () => void }) {
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");

  async function criarAprovacao() {
    setCreating(true);
    setMessage("");
    try {
      const res = await fetch("/api/financeiro/aprovacoes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idCliente }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Falha ao criar aprovação.");
      setMessage(json.created ? "Solicitação interna criada." : "Já existe solicitação pendente para esta fatura.");
      onApprovalCreated();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Falha ao criar aprovação.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/20 p-3 space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
        <Info label="Fatura" value={fatura.id} />
        <Info label="Valor aberto" value={money(fatura.valor)} />
        <Info label="Vencimento" value={fatura.data_vencimento || "-"} />
        <Info label="Status" value={fatura.status || "-"} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
        <Flag ok={fatura.has_linha_digitavel} label="Linha digitável/boleto" />
        <Flag ok={fatura.has_pix} label="PIX copia-e-cola" />
        <Flag ok={fatura.has_link} label="Link/PDF" />
      </div>
      {fatura.linha_digitavel ? <CopyBlock label="Linha digitável" value={fatura.linha_digitavel} /> : null}
      {fatura.pix_copia_cola ? <CopyBlock label="PIX copia-e-cola" value={fatura.pix_copia_cola} /> : null}
      {fatura.link ? <CopyBlock label="Link/PDF" value={fatura.link} /> : null}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={criarAprovacao}
          disabled={creating}
          className="rounded-lg bg-[#14B8A6] px-3 py-2 text-xs font-semibold hover:bg-[#0f9f90] disabled:opacity-40"
        >
          {creating ? "Criando..." : "Criar solicitação interna de envio"}
        </button>
        {message ? <span className="text-xs text-amber-200">{message}</span> : null}
      </div>
      <CopyBlock label="Mensagem pronta para cliente — copiar manualmente somente após conferência" value={mensagemClienteFatura(fatura)} />
      <p className="text-xs text-amber-200">Conferir no IXC antes de enviar ao cliente. Aprovação humana obrigatória. O sistema apenas prepara o texto; não envia automaticamente.</p>
    </div>
  );
}

function FaturaResumoView({ fatura }: { fatura: FaturaResumo }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-2 rounded-lg bg-[#0D1B2A] border border-[#2A4060] p-2 text-xs">
      <Info label="Fatura" value={fatura.id} />
      <Info label="Valor" value={money(fatura.valor)} />
      <Info label="Vencimento" value={fatura.data_vencimento || "-"} />
      <Info label="Status" value={fatura.status || "-"} />
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[#94A3B8]">{label}</p><p className="text-white break-all">{value || "-"}</p></div>;
}

function Flag({ ok, label }: { ok: boolean; label: string }) {
  return <div className={`rounded-lg border px-3 py-2 ${ok ? "border-emerald-500/20 text-emerald-300" : "border-rose-500/20 text-rose-300"}`}>{ok ? "✅" : "⚠️"} {label}</div>;
}

function CopyBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-[#0D1B2A] border border-[#2A4060] p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-xs text-[#94A3B8]">{label}</p>
        <button onClick={() => navigator.clipboard.writeText(value)} className="inline-flex items-center gap-1 text-xs text-[#14B8A6] hover:text-white">
          <Copy className="w-3 h-3" /> Copiar
        </button>
      </div>
      <p className="text-xs text-white break-all whitespace-pre-wrap">{value}</p>
    </div>
  );
}


function mensagemClienteFatura(fatura: FaturaDetalhe) {
  return buildMensagemCliente({
    faturaId: fatura.id,
    valor: fatura.valor,
    dataVencimento: fatura.data_vencimento,
    linhaDigitavel: fatura.linha_digitavel,
    pixCopiaCola: fatura.pix_copia_cola,
    link: fatura.link,
  });
}

function mensagemClienteAprovacao(aprovacao: AprovacaoEnvio) {
  return buildMensagemCliente({
    faturaId: aprovacao.faturaId,
    valor: aprovacao.valor,
    dataVencimento: aprovacao.dataVencimento,
    linhaDigitavel: aprovacao.linhaDigitavel || "",
    pixCopiaCola: aprovacao.pixCopiaCola || "",
    link: aprovacao.link || "",
  });
}

function buildMensagemCliente(input: { faturaId: string; valor: string; dataVencimento: string; linhaDigitavel?: string; pixCopiaCola?: string; link?: string }) {
  return [
    "Olá! Segue a segunda via da sua fatura da GLC Internet.",
    "",
    `Fatura: ${input.faturaId || "-"}`,
    `Valor: ${money(input.valor)}`,
    `Vencimento: ${input.dataVencimento || "-"}`,
    input.linhaDigitavel ? "" : undefined,
    input.linhaDigitavel ? `Código do boleto:\n${input.linhaDigitavel}` : undefined,
    input.pixCopiaCola ? "" : undefined,
    input.pixCopiaCola ? `PIX copia e cola:\n${input.pixCopiaCola}` : undefined,
    input.link ? "" : undefined,
    input.link ? `Link/PDF:\n${input.link}` : undefined,
    "",
    "Antes de pagar, confira se os dados estão em nome da GLC Internet.",
  ].filter((line): line is string => line !== undefined).join("\n");
}

function money(value: string) {
  return value ? `R$ ${value}` : "-";
}


function statusAprovacao(status: "pending" | "approved" | "rejected" | "manual_sent") {
  if (status === "pending") return "pendente";
  if (status === "approved") return "aprovado internamente";
  if (status === "manual_sent") return "enviado manualmente";
  return "rejeitado";
}

function formatDate(value: string) {
  try {
    return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
  } catch {
    return value;
  }
}
