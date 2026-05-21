"use client";

import { useMemo, useState } from "react";
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

const statusConfig: Record<Status, { label: string; cls: string; icon: React.ReactNode }> = {
  segura: { label: "Fatura segura", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300", icon: <ShieldCheck className="w-4 h-4" /> },
  multiplas: { label: "Bloqueado: múltiplas", cls: "border-amber-500/30 bg-amber-500/10 text-amber-300", icon: <FileWarning className="w-4 h-4" /> },
  sem_fatura: { label: "Sem fatura aberta", cls: "border-sky-500/30 bg-sky-500/10 text-sky-300", icon: <CheckCircle2 className="w-4 h-4" /> },
  indisponivel: { label: "IXC indisponível", cls: "border-rose-500/30 bg-rose-500/10 text-rose-300", icon: <XCircle className="w-4 h-4" /> },
};

export default function FinanceiroPage() {
  const [ids, setIds] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<FinanceiroResponse | null>(null);

  const cleanIds = useMemo(() => ids.split(/[\s,;]+/).map((id) => id.trim()).filter(Boolean), [ids]);

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
              <FinanceiroCard key={item.idCliente} item={item} />
            ))}
          </section>
        </>
      )}
    </div>
  );
}

function FinanceiroCard({ item }: { item: FinanceiroItem }) {
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

      {item.status === "segura" && item.fatura ? <FaturaSegura fatura={item.fatura} /> : null}

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

function FaturaSegura({ fatura }: { fatura: FaturaDetalhe }) {
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
      <p className="text-xs text-amber-200">Conferir no IXC antes de enviar ao cliente. Aprovação humana obrigatória.</p>
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
      <p className="text-xs text-white break-all">{value}</p>
    </div>
  );
}

function money(value: string) {
  return value ? `R$ ${value}` : "-";
}
