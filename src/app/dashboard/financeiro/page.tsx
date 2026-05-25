"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, CircleDollarSign, Copy, FileWarning, LayoutDashboard, Loader2, Lock, QrCode, RefreshCw, Search, ShieldCheck, XCircle } from "lucide-react";

type Status = "segura" | "multiplas" | "sem_fatura" | "indisponivel";

type FaturaResumo = {
  id: string;
  valor: string;
  data_vencimento: string;
  data_emissao?: string;
  status: string;
  status_cobranca?: string;
  has_linha_digitavel?: boolean;
  has_pix?: boolean;
  has_link?: boolean;
  field_lengths?: {
    linha_digitavel: number;
    pix_copia_cola: number;
    link: number;
    pix_txid: number;
  };
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
  documento_final?: string;
};

type AuditoriaFinanceira = {
  ts: string;
  action: string;
  status: string;
  id: string;
  clientId: string;
  faturaId: string;
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
  const [clienteSelecionado, setClienteSelecionado] = useState<ClienteBusca | null>(null);
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
  const [auditoria, setAuditoria] = useState<AuditoriaFinanceira[]>([]);

  const cleanIds = useMemo(() => ids.split(/[\s,;]+/).map((id) => id.trim()).filter(Boolean), [ids]);
  const approvalCounts = useMemo(() => countApprovals(aprovacoes), [aprovacoes]);
  const approvalSummary = useMemo(() => buildApprovalSummary(aprovacoes), [aprovacoes]);
  const approvalRiskSummary = useMemo(() => buildApprovalRiskSummary(aprovacoes), [aprovacoes]);
  const filteredApprovals = useMemo(() => sortApprovalsByDuePriority(filterApprovals(aprovacoes, approvalFilter, approvalSearch)), [aprovacoes, approvalFilter, approvalSearch]);

  useEffect(() => {
    carregarAprovacoes();
    carregarAuditoria();
  }, []);

  async function carregarAprovacoes() {
    const res = await fetch("/api/financeiro/aprovacoes");
    if (!res.ok) return;
    const json = await res.json();
    if (json.ok) setAprovacoes(json.items || []);
  }

  async function carregarAuditoria() {
    const res = await fetch("/api/financeiro/auditoria?limit=20");
    if (!res.ok) return;
    const json = await res.json();
    if (json.ok) setAuditoria(json.items || []);
  }

  async function atualizarFinanceiroInterno() {
    await carregarAprovacoes();
    await carregarAuditoria();
  }

  async function decidirAprovacao(id: string, action: "approve" | "reject" | "manual_sent", noteOverride?: string) {
    setApprovalMsg("");
    const note = noteOverride ?? approvalNotes[id] ?? "";
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
    await carregarAuditoria();
  }

  async function copiarMensagemEMarcarEnviado(aprovacao: AprovacaoEnvio) {
    setApprovalMsg("");
    const confirmed = window.confirm("Confirma que você conferiu no IXC, vai copiar a mensagem e marcar esta aprovação como enviada manualmente? Nenhum WhatsApp será enviado automaticamente.");
    if (!confirmed) return;

    try {
      await navigator.clipboard.writeText(mensagemClienteAprovacao(aprovacao));
      const manualNote = (approvalNotes[aprovacao.id] || "").trim() || `Mensagem copiada e marcada como enviada manualmente em ${new Date().toLocaleString("pt-BR")}.`;
      await decidirAprovacao(aprovacao.id, "manual_sent", manualNote);
      setApprovalMsg("Mensagem copiada. Envio manual registrado na auditoria. Nenhuma mensagem foi enviada automaticamente.");
    } catch {
      setApprovalMsg("Não foi possível copiar automaticamente. Copie pela mensagem aprovada e marque o envio manual depois de conferir.");
    }
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

  async function consultarIdsFinanceiro(idsConsulta: string) {
    setLoading(true);
    setError("");
    setData(null);
    try {
      const res = await fetch(`/api/financeiro/faturas?ids=${encodeURIComponent(idsConsulta)}`);
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Falha ao consultar financeiro.");
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao consultar financeiro.");
    } finally {
      setLoading(false);
    }
  }

  async function consultarCliente(cliente: ClienteBusca) {
    setClienteSelecionado(cliente);
    setClientes([cliente]);
    setIds(cliente.id);
    setBuscaCliente(cliente.nome || cliente.id);
    await consultarIdsFinanceiro(cliente.id);
  }

  async function consultar() {
    await consultarIdsFinanceiro(ids);
  }

  return (
    <div className="min-h-screen bg-[#0D1B2A] p-6 text-white space-y-6">
      <header className="flex flex-col gap-3">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <CircleDollarSign className="w-7 h-7 text-[#14B8A6]" />
              <h1 className="text-2xl font-bold">Financeiro Seguro — GLC Atende</h1>
            </div>
            <p className="text-sm text-[#94A3B8] max-w-3xl">
              Consulta interna para validar fatura única antes de qualquer boleto/PIX. Esta tela não envia mensagem para cliente e bloqueia casos com múltiplas faturas.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/dashboard"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#1E3050] border border-[#2A4060] hover:border-[#14B8A6]/40 px-4 py-2 text-xs text-[#CBD5E1] hover:text-white transition-all">
              <LayoutDashboard className="w-3.5 h-3.5" />
              Central
            </Link>
            <Link href="/dashboard/chamados"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#1E3050] border border-[#2A4060] hover:border-[#14B8A6]/40 px-4 py-2 text-xs text-[#CBD5E1] hover:text-white transition-all">
              <ArrowLeft className="w-3.5 h-3.5" />
              Voltar para chamados
            </Link>
          </div>
        </div>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <SafeStepCard
          step="1"
          title="Escolha o cliente"
          description="Busque por nome, telefone ou ID e consulte somente o cliente escolhido para evitar mistura de faturas."
        />
        <SafeStepCard
          step="2"
          title="Confirme a fatura"
          description="Envio só é seguro quando houver exatamente uma fatura aberta. Múltiplas faturas continuam bloqueadas."
        />
        <SafeStepCard
          step="3"
          title="Copie manualmente"
          description="A mensagem pronta é apenas apoio interno: confira no IXC antes de enviar ao cliente."
        />
      </section>

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
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[#94A3B8]">
                    <span>Status:</span>
                    <span className={`rounded-full border px-2 py-0.5 font-medium ${clienteStatusClass(cliente.status)}`}>
                      {clienteStatusLabel(cliente.status)}
                    </span>
                    <span>• {cliente.bairro || "bairro -"} / {cliente.cidade || "cidade -"}</span>
                    {cliente.telefone_final ? <span>• Tel. {cliente.telefone_final}</span> : null}
                    {cliente.documento_final ? <span>• CPF/CNPJ {cliente.documento_final}</span> : null}
                  </div>
                </div>
                <button
                  onClick={() => consultarCliente(cliente)}
                  disabled={loading}
                  className="rounded-lg bg-[#F97316] px-3 py-2 text-xs font-semibold hover:bg-[#ea6c0c] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {loading ? "Consultando..." : "Consultar financeiro deste cliente"}
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
        {clienteSelecionado ? (
          <div className="rounded-xl bg-[#0F2744] border border-[#2A4060] p-4 space-y-2">
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-[#94A3B8]">Cliente selecionado</p>
                <p className="mt-1 font-semibold">{clienteSelecionado.nome}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[#94A3B8]">
                  <span className={`rounded-full border px-2 py-0.5 font-medium ${clienteStatusClass(clienteSelecionado.status)}`}>
                    {clienteStatusLabel(clienteSelecionado.status)}
                  </span>
                  <span>• {clienteSelecionado.bairro || "bairro -"} / {clienteSelecionado.cidade || "cidade -"}</span>
                  {clienteSelecionado.telefone_final ? <span>• Tel. {clienteSelecionado.telefone_final}</span> : null}
                  {clienteSelecionado.documento_final ? <span>• CPF/CNPJ {clienteSelecionado.documento_final}</span> : null}
                </div>
              </div>
              <button
                onClick={() => { setClienteSelecionado(null); setIds(""); setData(null); setError(""); }}
                className="rounded-lg bg-[#1E3050] border border-[#2A4060] px-3 py-2 text-xs text-[#CBD5E1] hover:text-white"
              >
                Trocar cliente
              </button>
            </div>
            <p className="text-xs text-emerald-200 bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3">
              Conferência recomendada: antes de copiar boleto/PIX, peça para o cliente confirmar nome completo e CPF/CNPJ. O ID fica oculto para o atendente porque a consulta já foi feita pelo cliente selecionado.
            </p>
          </div>
        ) : (
          <details className="rounded-xl bg-[#0F2744] border border-[#2A4060] p-4">
            <summary className="cursor-pointer text-sm font-medium text-[#CBD5E1]">Consulta avançada por ID</summary>
            <label className="mt-3 block text-sm font-medium text-[#CBD5E1]">
              IDs dos clientes
              <textarea
                value={ids}
                onChange={(e) => setIds(e.target.value)}
                placeholder="Ex.: 12345, 67890 ou um ID por linha"
                className="mt-2 min-h-24 w-full rounded-xl bg-[#0D1B2A] border border-[#2A4060] px-4 py-3 text-sm text-white placeholder-[#94A3B8]/60 focus:outline-none focus:border-[#14B8A6]"
              />
            </label>
          </details>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={consultar}
            disabled={loading || cleanIds.length === 0 || Boolean(clienteSelecionado)}
            className="inline-flex items-center gap-2 rounded-xl bg-[#F97316] hover:bg-[#ea6c0c] disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2 text-sm font-semibold"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            {clienteSelecionado ? "Cliente já consultado" : "Consultar faturas"}
          </button>
          <button
            onClick={() => { setIds(""); setClienteSelecionado(null); setData(null); setError(""); }}
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
              <FinanceiroCard key={item.idCliente} item={item} onApprovalCreated={atualizarFinanceiroInterno} />
            ))}
          </section>
        </>
      )}
      <section className="bg-[#1E3050] border border-[#2A4060] rounded-2xl p-5 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Solicitações internas de envio</h2>
          <p className="text-xs text-[#94A3B8] mt-1">Aprovação apenas interna nesta fase. O sistema ainda não envia WhatsApp para cliente.</p>
        </div>
        {aprovacoes.length > 0 ? <ApprovalSummaryCards summary={approvalSummary} /> : null}
        {aprovacoes.length > 0 ? <ApprovalRiskSummaryCards summary={approvalRiskSummary} /> : null}
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
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => exportApprovalsCsv(filteredApprovals)} className="rounded-xl bg-[#0F2744] border border-[#2A4060] px-4 py-2 text-xs text-[#CBD5E1] hover:text-white">Exportar CSV filtrado</button>
              <button onClick={() => exportApprovalsJson(filteredApprovals)} className="rounded-xl bg-[#0F2744] border border-[#2A4060] px-4 py-2 text-xs text-[#CBD5E1] hover:text-white">Exportar JSON filtrado</button>
              <span className="text-xs text-[#94A3B8]">Exporta somente registros visíveis no filtro/busca atual. Lista ordenada por vencimento/prioridade.</span>
            </div>
          </div>
        ) : null}
        {aprovacoes.length === 0 ? (
          <p className="text-sm text-[#94A3B8]">Nenhuma solicitação registrada ainda.</p>
        ) : filteredApprovals.length === 0 ? (
          <p className="text-sm text-[#94A3B8]">Nenhuma solicitação neste filtro.</p>
        ) : (
          <div className="space-y-2">
            {filteredApprovals.length > 10 ? (
              <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-3 text-xs text-amber-100">
                Exibindo as 10 solicitações mais urgentes de {filteredApprovals.length} encontradas no filtro atual. Use busca/filtros ou exporte CSV/JSON para auditoria completa.
              </div>
            ) : null}
            {filteredApprovals.slice(0, 10).map((aprovacao) => (
              <div key={aprovacao.id} className="rounded-xl bg-[#0F2744] border border-[#2A4060] p-3 text-sm space-y-2">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold">Cliente #{aprovacao.idCliente} • Fatura #{aprovacao.faturaId} • R$ {aprovacao.valor || "-"}</p>
                    <p className="text-xs text-[#94A3B8]">Status: {statusAprovacao(aprovacao.status)} • Criada em {formatDate(aprovacao.createdAt)}</p>
                    <DueBadge dueDate={aprovacao.dataVencimento} />
                    <p className="text-xs text-[#94A3B8]">Criado por: {aprovacao.createdBy || "dashboard"}{aprovacao.decidedBy ? ` • Última decisão: ${aprovacao.decidedBy}` : ""}</p>
                  </div>
                  {aprovacao.status === "pending" ? (
                    <div className="flex gap-2">
                      <button onClick={() => decidirAprovacao(aprovacao.id, "approve")} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold hover:bg-emerald-500">Aprovar internamente</button>
                      <button onClick={() => decidirAprovacao(aprovacao.id, "reject")} className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold hover:bg-rose-500">Rejeitar</button>
                    </div>
                  ) : aprovacao.status === "approved" ? (
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => copiarMensagemEMarcarEnviado(aprovacao)} className="rounded-lg bg-[#14B8A6] px-3 py-2 text-xs font-semibold hover:bg-[#0f9f90]">Copiar mensagem + marcar enviado</button>
                      <button onClick={() => decidirAprovacao(aprovacao.id, "manual_sent")} className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-semibold hover:bg-sky-500">Só marcar enviado manualmente</button>
                    </div>
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

      <section className="bg-[#1E3050] border border-[#2A4060] rounded-2xl p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Auditoria financeira recente</h2>
            <p className="text-xs text-[#94A3B8] mt-1">Rastro interno das solicitações, aprovações, rejeições e marcações de envio manual. Dados sensíveis continuam fora do log.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={carregarAuditoria} className="rounded-xl bg-[#0F2744] border border-[#2A4060] px-4 py-2 text-xs text-[#CBD5E1] hover:text-white">Atualizar auditoria</button>
            <button onClick={() => exportAuditCsv(auditoria)} disabled={auditoria.length === 0} className="rounded-xl bg-[#0F2744] border border-[#2A4060] px-4 py-2 text-xs text-[#CBD5E1] hover:text-white disabled:opacity-40">Exportar CSV</button>
            <button onClick={() => exportAuditJson(auditoria)} disabled={auditoria.length === 0} className="rounded-xl bg-[#0F2744] border border-[#2A4060] px-4 py-2 text-xs text-[#CBD5E1] hover:text-white disabled:opacity-40">Exportar JSON</button>
          </div>
        </div>
        {auditoria.length > 0 ? <AuditSummary events={auditoria} /> : null}
        {auditoria.length === 0 ? (
          <p className="text-sm text-[#94A3B8]">Nenhum evento financeiro auditado ainda.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[#2A4060]">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-[#0F2744] text-[#94A3B8]">
                <tr>
                  <th className="px-3 py-2">Data</th>
                  <th className="px-3 py-2">Evento</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Cliente</th>
                  <th className="px-3 py-2">Fatura</th>
                  <th className="px-3 py-2">Protocolo</th>
                </tr>
              </thead>
              <tbody>
                {auditoria.map((event, index) => (
                  <tr key={`${event.ts}-${event.id}-${index}`} className="border-t border-[#2A4060] bg-[#0D1B2A] text-[#CBD5E1]">
                    <td className="px-3 py-2 whitespace-nowrap">{event.ts ? formatDate(event.ts) : "-"}</td>
                    <td className="px-3 py-2">{auditActionLabel(event.action)}</td>
                    <td className="px-3 py-2">{event.status || "-"}</td>
                    <td className="px-3 py-2">{event.clientId || "-"}</td>
                    <td className="px-3 py-2">{event.faturaId || "-"}</td>
                    <td className="px-3 py-2 font-mono">{event.id ? event.id.slice(0, 8) : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

    </div>
  );
}






function AuditSummary({ events }: { events: AuditoriaFinanceira[] }) {
  const summary = events.reduce((acc, event) => {
    if (event.action === "finance_approval_create") acc.created += 1;
    else if (event.action === "finance_approval_decide" && event.status === "approved") acc.approved += 1;
    else if (event.action === "finance_approval_decide" && event.status === "rejected") acc.rejected += 1;
    else if (event.action === "finance_approval_manual_sent") acc.manualSent += 1;
    return acc;
  }, { created: 0, approved: 0, rejected: 0, manualSent: 0 });

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
      <AuditMiniCard label="Criadas" value={summary.created} />
      <AuditMiniCard label="Aprovadas" value={summary.approved} />
      <AuditMiniCard label="Rejeitadas" value={summary.rejected} />
      <AuditMiniCard label="Envio manual" value={summary.manualSent} />
    </div>
  );
}

function AuditMiniCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-[#2A4060] bg-[#0F2744] p-3">
      <p className="text-[11px] text-[#94A3B8]">Auditoria recente</p>
      <p className="mt-1 text-sm font-semibold text-[#CBD5E1]">{label}</p>
      <p className="mt-1 text-2xl font-bold text-white">{value}</p>
    </div>
  );
}

function buildApprovalRiskSummary(aprovacoes: AprovacaoEnvio[]) {
  return aprovacoes.reduce((acc, aprovacao) => {
    const diffDays = getDuePriorityValue(aprovacao.dataVencimento);
    if (diffDays < 0) acc.overdue += 1;
    else if (diffDays === 0) acc.today += 1;
    else if (diffDays <= 3) acc.nextThreeDays += 1;
    return acc;
  }, { overdue: 0, today: 0, nextThreeDays: 0 });
}

function ApprovalRiskSummaryCards({ summary }: { summary: ReturnType<typeof buildApprovalRiskSummary> }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <RiskCard label="Vencidas" value={summary.overdue} className="border-rose-500/30 bg-rose-500/10 text-rose-100" />
      <RiskCard label="Vencem hoje" value={summary.today} className="border-orange-500/30 bg-orange-500/10 text-orange-100" />
      <RiskCard label="Vencem em até 3 dias" value={summary.nextThreeDays} className="border-amber-500/30 bg-amber-500/10 text-amber-100" />
    </div>
  );
}

function SafeStepCard({ step, title, description }: { step: string; title: string; description: string }) {
  return (
    <div className="rounded-2xl bg-[#1E3050] border border-[#2A4060] p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#14B8A6]/30 bg-[#14B8A6]/10 text-sm font-bold text-[#5EEAD4]">
          {step}
        </span>
        <div>
          <p className="text-sm font-semibold text-white">{title}</p>
          <p className="mt-1 text-xs leading-relaxed text-[#94A3B8]">{description}</p>
        </div>
      </div>
    </div>
  );
}

function RiskCard({ label, value, className }: { label: string; value: number; className: string }) {
  return (
    <div className={`rounded-2xl border p-4 ${className}`}>
      <p className="text-xs opacity-80">Risco por vencimento</p>
      <p className="mt-1 text-sm font-semibold">{label}</p>
      <p className="mt-2 text-3xl font-bold">{value}</p>
    </div>
  );
}

function buildApprovalSummary(aprovacoes: AprovacaoEnvio[]) {
  const totalManualSent = aprovacoes
    .filter((aprovacao) => aprovacao.status === "manual_sent")
    .reduce((sum, aprovacao) => sum + parseMoneyValue(aprovacao.valor), 0);

  const totalApprovedOpen = aprovacoes
    .filter((aprovacao) => aprovacao.status === "approved")
    .reduce((sum, aprovacao) => sum + parseMoneyValue(aprovacao.valor), 0);

  const lastUpdate = aprovacoes
    .map((aprovacao) => aprovacao.updatedAt || aprovacao.createdAt)
    .sort()
    .at(-1) || "";

  return { totalManualSent, totalApprovedOpen, lastUpdate };
}

function parseMoneyValue(value: string) {
  const normalized = String(value || "0")
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function ApprovalSummaryCards({ summary }: { summary: ReturnType<typeof buildApprovalSummary> }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
        <p className="text-xs text-emerald-200">Valor marcado como enviado manualmente</p>
        <p className="mt-2 text-2xl font-bold text-emerald-100">R$ {formatMoneyNumber(summary.totalManualSent)}</p>
      </div>
      <div className="rounded-2xl border border-sky-500/20 bg-sky-500/10 p-4">
        <p className="text-xs text-sky-200">Valor aprovado aguardando envio manual</p>
        <p className="mt-2 text-2xl font-bold text-sky-100">R$ {formatMoneyNumber(summary.totalApprovedOpen)}</p>
      </div>
      <div className="rounded-2xl border border-[#2A4060] bg-[#0F2744] p-4">
        <p className="text-xs text-[#94A3B8]">Última movimentação financeira interna</p>
        <p className="mt-2 text-lg font-bold text-white">{summary.lastUpdate ? formatDate(summary.lastUpdate) : "-"}</p>
        <p className="mt-1 text-xs text-amber-200">Resumo interno. Não representa baixa no IXC.</p>
      </div>
    </div>
  );
}

function formatMoneyNumber(value: number) {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function exportAuditCsv(events: AuditoriaFinanceira[]) {
  const rows = events.map((event) => ({
    data: event.ts,
    evento: auditActionLabel(event.action),
    acao: event.action,
    status: event.status,
    cliente: event.clientId,
    fatura: event.faturaId,
    protocolo: event.id,
  }));
  const headers = Object.keys(rows[0] || { data: "", evento: "", acao: "", status: "", cliente: "", fatura: "", protocolo: "" });
  const csv = [headers.join(","), ...rows.map((row) => headers.map((header) => csvCell(row[header as keyof typeof row])).join(","))].join("\n");
  downloadTextFile(`glc-auditoria-financeira-${dateStamp()}.csv`, csv, "text/csv;charset=utf-8");
}

function exportAuditJson(events: AuditoriaFinanceira[]) {
  downloadTextFile(`glc-auditoria-financeira-${dateStamp()}.json`, JSON.stringify({ exportedAt: new Date().toISOString(), total: events.length, items: events }, null, 2), "application/json;charset=utf-8");
}

function exportApprovalsCsv(aprovacoes: AprovacaoEnvio[]) {
  const rows = aprovacoes.map((aprovacao) => ({
    protocolo: aprovacao.id,
    status: aprovacao.status,
    cliente: aprovacao.idCliente,
    fatura: aprovacao.faturaId,
    valor: aprovacao.valor,
    vencimento: aprovacao.dataVencimento,
    criado_em: aprovacao.createdAt,
    atualizado_em: aprovacao.updatedAt,
    criado_por: aprovacao.createdBy || "",
    decidido_por: aprovacao.decidedBy || "",
    observacao: aprovacao.note || "",
    tem_linha_digitavel: aprovacao.hasLinhaDigitavel ? "sim" : "nao",
    tem_pix: aprovacao.hasPix ? "sim" : "nao",
    tem_link: aprovacao.hasLink ? "sim" : "nao",
  }));
  const headers = Object.keys(rows[0] || { protocolo: "", status: "", cliente: "", fatura: "", valor: "", vencimento: "", criado_em: "", atualizado_em: "", criado_por: "", decidido_por: "", observacao: "", tem_linha_digitavel: "", tem_pix: "", tem_link: "" });
  const csv = [headers.join(","), ...rows.map((row) => headers.map((header) => csvCell(row[header as keyof typeof row])).join(","))].join("\n");
  downloadTextFile(`glc-aprovacoes-${dateStamp()}.csv`, csv, "text/csv;charset=utf-8");
}

function exportApprovalsJson(aprovacoes: AprovacaoEnvio[]) {
  const safe = aprovacoes.map((aprovacao) => ({
    id: aprovacao.id,
    status: aprovacao.status,
    idCliente: aprovacao.idCliente,
    faturaId: aprovacao.faturaId,
    valor: aprovacao.valor,
    dataVencimento: aprovacao.dataVencimento,
    hasLinhaDigitavel: aprovacao.hasLinhaDigitavel,
    hasPix: aprovacao.hasPix,
    hasLink: aprovacao.hasLink,
    createdAt: aprovacao.createdAt,
    updatedAt: aprovacao.updatedAt,
    createdBy: aprovacao.createdBy,
    decidedBy: aprovacao.decidedBy || "",
    note: aprovacao.note || "",
    safetyMessage: aprovacao.safetyMessage,
  }));
  downloadTextFile(`glc-aprovacoes-${dateStamp()}.json`, JSON.stringify({ exportedAt: new Date().toISOString(), total: safe.length, items: safe }, null, 2), "application/json;charset=utf-8");
}

function csvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function downloadTextFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}


function sortApprovalsByDuePriority(aprovacoes: AprovacaoEnvio[]) {
  return [...aprovacoes].sort((a, b) => {
    const dueA = getDuePriorityValue(a.dataVencimento);
    const dueB = getDuePriorityValue(b.dataVencimento);
    if (dueA !== dueB) return dueA - dueB;

    const statusA = statusPriority(a.status);
    const statusB = statusPriority(b.status);
    if (statusA !== statusB) return statusA - statusB;

    return (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt);
  });
}

function getDuePriorityValue(value: string) {
  const due = parseDueDate(value);
  if (!due) return 999999;

  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((due.getTime() - startToday.getTime()) / 86400000);
}

function statusPriority(status: AprovacaoEnvio["status"]) {
  if (status === "pending") return 0;
  if (status === "approved") return 1;
  if (status === "manual_sent") return 2;
  return 3;
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
        <div>
          <p className="text-[#94A3B8]">Urgência</p>
          <DueBadge dueDate={fatura.data_vencimento} />
        </div>
        <Info label="Status" value={fatura.status || "-"} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
        <Flag ok={fatura.has_linha_digitavel} label="Linha digitável/boleto" />
        <Flag ok={fatura.has_pix} label="PIX copia-e-cola" />
        <Flag ok={fatura.has_link} label="Link/PDF" />
      </div>
      <IxcValidationPanel fatura={fatura} segura />
      {fatura.linha_digitavel ? <CopyBlock label="Linha digitável" value={fatura.linha_digitavel} /> : null}
      {fatura.pix_copia_cola ? (
        <>
          <CopyBlock label="PIX copia-e-cola" value={fatura.pix_copia_cola} />
          <PixQrCode payload={fatura.pix_copia_cola} />
        </>
      ) : null}
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


function PixQrCode({ payload }: { payload: string }) {
  const src = `/api/financeiro/pix-qrcode?payload=${encodeURIComponent(payload)}`;

  return (
    <div className="rounded-lg bg-[#0D1B2A] border border-[#2A4060] p-3 space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-[#CBD5E1]">
        <QrCode className="w-4 h-4 text-[#14B8A6]" />
        QR Code PIX — conferência interna
      </div>
      <div className="flex flex-col md:flex-row gap-3 md:items-center">
        <div className="rounded-xl bg-white p-3 w-fit">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="QR Code PIX gerado a partir do copia-e-cola" className="h-40 w-40" />
        </div>
        <div className="text-xs text-[#94A3B8] space-y-2 max-w-xl">
          <p>Gerado localmente a partir do PIX copia-e-cola retornado pelo IXC.</p>
          <p className="text-amber-200">Uso interno: conferir cliente, valor e vencimento antes de qualquer envio manual. O sistema não envia WhatsApp, não baixa pagamento e não altera o IXC.</p>
        </div>
      </div>
    </div>
  );
}

function FaturaResumoView({ fatura }: { fatura: FaturaResumo }) {
  return (
    <div className="rounded-lg bg-[#0D1B2A] border border-[#2A4060] p-2 text-xs space-y-2">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <Info label="Fatura" value={fatura.id} />
        <Info label="Valor" value={money(fatura.valor)} />
        <Info label="Vencimento" value={fatura.data_vencimento || "-"} />
        <div>
          <p className="text-[#94A3B8]">Urgência</p>
          <DueBadge dueDate={fatura.data_vencimento} />
        </div>
        <Info label="Status" value={fatura.status || "-"} />
      </div>
      <IxcValidationPanel fatura={fatura} />
    </div>
  );
}

function IxcValidationPanel({ fatura, segura = false }: { fatura: FaturaResumo; segura?: boolean }) {
  const lengths = fatura.field_lengths;
  const checks = [
    { label: "linha/boleto", ok: Boolean(fatura.has_linha_digitavel), detail: lengths ? `${lengths.linha_digitavel} caract.` : "-" },
    { label: "PIX", ok: Boolean(fatura.has_pix), detail: lengths ? `${lengths.pix_copia_cola} caract.` : "-" },
    { label: "link/PDF", ok: Boolean(fatura.has_link), detail: lengths ? `${lengths.link} caract.` : "-" },
    { label: "TXID", ok: Boolean(lengths?.pix_txid), detail: lengths ? `${lengths.pix_txid} caract.` : "-" },
  ];

  return (
    <div className="rounded-lg border border-[#2A4060] bg-[#0F2744] p-3 space-y-2">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-1">
        <p className="text-xs font-semibold text-[#CBD5E1]">Validação IXC — campos reais retornados</p>
        <p className="text-[11px] text-amber-200">{segura ? "Fatura única localizada" : "Resumo bloqueado para conferência manual"}</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {checks.map((check) => (
          <div key={check.label} className={`rounded-md border px-2 py-1 ${check.ok ? "border-emerald-500/20 text-emerald-200" : "border-slate-500/20 text-slate-300"}`}>
            <p className="font-medium">{check.ok ? "✅" : "—"} {check.label}</p>
            <p className="text-[11px] opacity-75">{check.detail}</p>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-[#94A3B8]">
        Use este bloco nos 3 testes reais: sem fatura, fatura única e múltiplas. Ele confirma presença/tamanho dos campos sem registrar token ou baixar pagamento.
      </p>
    </div>
  );
}


function DueBadge({ dueDate }: { dueDate: string }) {
  const urgency = getDueUrgency(dueDate);
  return (
    <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${urgency.cls}`}>
      {urgency.label}
    </span>
  );
}

function getDueUrgency(value: string) {
  const due = parseDueDate(value);
  if (!due) return { label: "Vencimento não informado", cls: "border-[#2A4060] bg-[#0F2744] text-[#94A3B8]" };

  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diffDays = Math.round((due.getTime() - startToday.getTime()) / 86400000);

  if (diffDays < 0) return { label: `Vencida há ${Math.abs(diffDays)} dia(s)`, cls: "border-rose-500/30 bg-rose-500/10 text-rose-200" };
  if (diffDays === 0) return { label: "Vence hoje", cls: "border-orange-500/30 bg-orange-500/10 text-orange-200" };
  if (diffDays <= 3) return { label: `Vence em ${diffDays} dia(s)`, cls: "border-amber-500/30 bg-amber-500/10 text-amber-200" };
  return { label: `Vence em ${diffDays} dia(s)`, cls: "border-emerald-500/20 bg-emerald-500/10 text-emerald-200" };
}

function parseDueDate(value: string) {
  const clean = String(value || "").trim();
  if (!clean) return null;

  const br = clean.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]));

  const iso = clean.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

  const parsed = new Date(clean);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
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

function clienteStatusLabel(status: string) {
  const normalized = String(status || "").trim().toUpperCase();
  if (["A", "ATIVO", "ACTIVE", "S", "SIM", "1", "TRUE"].includes(normalized)) return "Ativo";
  if (["I", "INATIVO", "INACTIVE", "D", "DESATIVADO", "DESATIVADA", "N", "NAO", "NÃO", "0", "FALSE"].includes(normalized)) return "Desativado";
  if (["B", "BLOQUEADO", "BLOQUEADA", "SUSPENSO", "SUSPENSA"].includes(normalized)) return "Bloqueado";
  if (["C", "CANCELADO", "CANCELADA"].includes(normalized)) return "Cancelado";
  return status || "Não informado";
}

function clienteStatusClass(status: string) {
  const label = clienteStatusLabel(status);
  if (label === "Ativo") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  if (label === "Bloqueado") return "border-amber-500/30 bg-amber-500/10 text-amber-300";
  if (label === "Cancelado") return "border-rose-500/30 bg-rose-500/10 text-rose-300";
  if (label === "Desativado") return "border-slate-500/30 bg-slate-500/10 text-slate-300";
  return "border-[#2A4060] bg-[#0D1B2A] text-[#CBD5E1]";
}

function auditActionLabel(action: string) {
  if (action === "finance_approval_create") return "Solicitação criada";
  if (action === "finance_approval_decide") return "Decisão registrada";
  if (action === "finance_approval_manual_sent") return "Envio manual marcado";
  return action || "-";
}

function formatDate(value: string) {
  try {
    return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
  } catch {
    return value;
  }
}
