import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, CheckCircle2, Download, Share2 } from "lucide-react";
import { toast } from "sonner";
import type { jsPDF } from "jspdf";
import { fmtBRL, fmtDate, firstDayOfMonth, today } from "@/lib/format";
import { buildDespesasPDF, pdfFilename, savePDF, sharePDF, type DespesaRow } from "@/lib/pdf";
import { PageHeader } from "@/components/PageHeader";
import { requireAdmin } from "@/lib/profile";

export const Route = createFileRoute("/_authenticated/fechamento")({
  beforeLoad: requireAdmin,
  head: () => ({
    meta: [
      { title: "Fechamento — Hubvision" },
      { name: "description", content: "Feche períodos de despesas e gere relatórios PDF." },
      { property: "og:title", content: "Fechamento — Hubvision" },
      { property: "og:description", content: "Gere e compartilhe relatórios de prestação de contas." },
    ],
  }),
  component: FechamentoPage,
});

interface DespesaLite {
  id: string; valor: number; data_despesa: string; tipo_despesa: string; descricao: string | null;
  status: string; user_id: string;
  colaborador: { nome: string } | null;
}

interface Relatorio {
  id: string; data_inicio: string; data_fim: string; colaborador_id: string | null;
  total: number; quantidade: number; created_at: string;
  colaborador: { nome: string } | null;
}

const DESPESA_COLS = "id, valor, data_despesa, tipo_despesa, descricao, status, user_id, colaborador:profiles!despesas_user_id_fkey(nome)";

function toRows(despesas: DespesaLite[]): DespesaRow[] {
  return despesas.map((d) => ({
    colaborador: d.colaborador?.nome ?? "—",
    tipo_despesa: d.tipo_despesa,
    data_despesa: d.data_despesa,
    status: d.status,
    valor: Number(d.valor),
    descricao: d.descricao,
  }));
}

function fechamentoPDF(inicio: string, fim: string, colab: string | null, rows: DespesaRow[], concluidoEm: string) {
  return buildDespesasPDF({
    titulo: "Relatório de Fechamento",
    meta: [
      `Período: ${fmtDate(inicio)} a ${fmtDate(fim)}`,
      `Colaborador: ${colab || "Todos"}`,
      `Concluído em: ${concluidoEm}`,
    ],
    despesas: rows,
  });
}

function FechamentoPage() {
  const [tab, setTab] = useState<"novo" | "historico">("novo");

  return (
    <div className="px-4 pt-6 pb-4">
      <PageHeader title="Fechamento" subtitle="Feche o período e gere o PDF" />

      <div className="inline-flex p-1 rounded-full bg-muted mb-5">
        {[
          { k: "novo", label: "Novo fechamento" },
          { k: "historico", label: "Histórico" },
        ].map((t) => (
          <button key={t.k} onClick={() => setTab(t.k as "novo" | "historico")}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition ${
              tab === t.k ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground"
            }`}>{t.label}</button>
        ))}
      </div>

      {tab === "novo" ? <NovoFechamento /> : <Historico />}
    </div>
  );
}

function NovoFechamento() {
  const qc = useQueryClient();
  const [dataInicio, setDataInicio] = useState(firstDayOfMonth());
  const [dataFim, setDataFim] = useState(today());
  const [colabFilter, setColabFilter] = useState<string>("todos");
  const [concluded, setConcluded] = useState<{ inicio: string; fim: string; colab: string | null; rows: DespesaRow[]; total: number } | null>(null);

  const { data: colaboradores = [] } = useQuery({
    queryKey: ["profiles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, nome, ativo").order("nome");
      if (error) throw error;
      return data;
    },
  });

  // Tudo que está em aberto no período: aprovadas entram no fechamento; pendentes só geram aviso.
  const { data: abertas = [] } = useQuery<DespesaLite[]>({
    queryKey: ["despesas", "fechamento", dataInicio, dataFim, colabFilter],
    enabled: !!dataInicio && !!dataFim && dataFim >= dataInicio,
    queryFn: async () => {
      let q = supabase
        .from("despesas")
        .select(DESPESA_COLS)
        .is("relatorio_id", null)
        .in("status", ["aprovado", "pendente"])
        .gte("data_despesa", dataInicio)
        .lte("data_despesa", dataFim)
        .order("data_despesa", { ascending: true });
      if (colabFilter !== "todos") q = q.eq("user_id", colabFilter);
      const { data, error } = await q;
      if (error) throw error;
      return data as unknown as DespesaLite[];
    },
  });

  const aprovadas = useMemo(() => abertas.filter((d) => d.status === "aprovado"), [abertas]);
  const pendentes = abertas.length - aprovadas.length;
  const total = useMemo(() => aprovadas.reduce((a, d) => a + Number(d.valor), 0), [aprovadas]);

  const conclude = useMutation({
    mutationFn: async () => {
      const { data: relId, error } = await supabase.rpc("concluir_fechamento", {
        p_data_inicio: dataInicio,
        p_data_fim: dataFim,
        p_colaborador_id: colabFilter === "todos" ? null : colabFilter,
      });
      if (error) throw error;
      // Usa exatamente o que o banco travou no fechamento (pode diferir da prévia se algo mudou no meio).
      const { data, error: e2 } = await supabase
        .from("despesas")
        .select(DESPESA_COLS)
        .eq("relatorio_id", relId)
        .order("data_despesa", { ascending: true });
      if (e2) throw e2;
      return data as unknown as DespesaLite[];
    },
    onSuccess: (fechadas) => {
      qc.invalidateQueries({ queryKey: ["despesas"] });
      qc.invalidateQueries({ queryKey: ["relatorios"] });
      const rows = toRows(fechadas);
      setConcluded({
        inicio: dataInicio,
        fim: dataFim,
        colab: colabFilter === "todos" ? null : colaboradores.find((c) => c.id === colabFilter)?.nome ?? null,
        rows,
        total: rows.reduce((a, r) => a + r.valor, 0),
      });
      toast.success("Fechamento concluído!");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (concluded) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
        <div className="mx-auto size-14 rounded-full bg-[var(--color-status-approved-bg)] flex items-center justify-center">
          <CheckCircle2 className="size-7 text-[var(--color-status-approved)]" />
        </div>
        <h3 className="mt-4 text-lg font-semibold">Fechamento concluído</h3>
        <p className="text-sm text-muted-foreground">
          {fmtDate(concluded.inicio)} a {fmtDate(concluded.fim)} · {concluded.rows.length} despesas
        </p>
        <div className="mt-3 text-3xl font-mono-ledger font-bold">{fmtBRL(concluded.total)}</div>

        <PDFButtons
          onGet={() => fechamentoPDF(concluded.inicio, concluded.fim, concluded.colab, concluded.rows, new Date().toLocaleString("pt-BR"))}
          filename={pdfFilename(concluded.inicio, concluded.fim, concluded.colab)}
        />

        <Button variant="outline" className="mt-3 w-full" onClick={() => setConcluded(null)}>
          Iniciar novo fechamento
        </Button>
      </div>
    );
  }

  // Prévia agrupada por colaborador
  const porColab = new Map<string, { nome: string; qtd: number; total: number }>();
  for (const d of aprovadas) {
    const c = porColab.get(d.user_id) ?? { nome: d.colaborador?.nome ?? "—", qtd: 0, total: 0 };
    c.qtd += 1;
    c.total += Number(d.valor);
    porColab.set(d.user_id, c);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Data inicial</Label>
            <Input type="date" className="font-mono-ledger" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Data final</Label>
            <Input type="date" className="font-mono-ledger" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Colaborador</Label>
          <Select value={colabFilter} onValueChange={setColabFilter}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              {colaboradores.map((c) => (<SelectItem key={c.id} value={c.id}>{c.nome}{!c.ativo && " (inativo)"}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="rounded-2xl border border-[var(--color-gold)]/60 bg-[var(--color-gold-soft)]/60 p-5">
        <div className="text-[11px] uppercase tracking-wider font-semibold text-[var(--color-ink)]/70">Aprovadas no período</div>
        <div className="mt-1 text-3xl font-mono-ledger font-bold text-[var(--color-ink)]">{fmtBRL(total)}</div>
        <div className="text-xs text-[var(--color-ink)]/70">{aprovadas.length} despesa(s) entram no fechamento</div>
      </div>

      {pendentes > 0 && (
        <div className="flex items-start gap-2 rounded-2xl border border-[var(--color-status-pending)]/40 bg-[var(--color-status-pending-bg)] p-4 text-sm text-[var(--color-status-pending)]">
          <AlertTriangle className="size-4 mt-0.5 shrink-0" />
          <span>
            {pendentes} despesa(s) do período ainda estão <b>pendentes</b> e não entram neste fechamento.
            Aprove ou rejeite antes, se quiser incluí-las.
          </span>
        </div>
      )}

      {porColab.size > 0 && (
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-2">Por colaborador</div>
          <ul className="divide-y divide-border">
            {[...porColab.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")).map((c) => (
              <li key={c.nome} className="py-2 flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium">{c.nome}</div>
                  <div className="text-xs text-muted-foreground">{c.qtd} despesa(s)</div>
                </div>
                <div className="font-mono-ledger font-semibold">{fmtBRL(c.total)}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Button
        className="w-full h-12 text-base font-semibold"
        disabled={conclude.isPending || aprovadas.length === 0}
        onClick={() => { if (confirm("Concluir fechamento? As despesas incluídas ficarão bloqueadas.")) conclude.mutate(); }}
      >
        {conclude.isPending ? "Processando…" : "Concluir fechamento"}
      </Button>
    </div>
  );
}

function Historico() {
  const { data: relatorios = [], isLoading } = useQuery<Relatorio[]>({
    queryKey: ["relatorios"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("relatorios_fechamento")
        .select("*, colaborador:profiles!relatorios_fechamento_colaborador_id_fkey(nome)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as unknown as Relatorio[];
    },
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (relatorios.length === 0)
    return (
      <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground text-sm">
        Nenhum fechamento concluído ainda.
      </div>
    );

  return (
    <div className="space-y-3">
      {relatorios.map((r) => <HistoricoCard key={r.id} r={r} />)}
    </div>
  );
}

function HistoricoCard({ r }: { r: Relatorio }) {
  const colab = r.colaborador?.nome ?? null;
  const buildPdf = async () => {
    const { data, error } = await supabase
      .from("despesas")
      .select(DESPESA_COLS)
      .eq("relatorio_id", r.id)
      .order("data_despesa", { ascending: true });
    if (error) throw error;
    return fechamentoPDF(r.data_inicio, r.data_fim, colab, toRows(data as unknown as DespesaLite[]),
      new Date(r.created_at).toLocaleString("pt-BR"));
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold font-mono-ledger">
            {fmtDate(r.data_inicio)} → {fmtDate(r.data_fim)}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {colab || "Todos"} · {r.quantidade} despesa(s)
          </div>
        </div>
        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-[var(--color-status-approved-bg)] text-[var(--color-status-approved)]">
          concluído
        </span>
      </div>
      <div className="mt-2 text-2xl font-mono-ledger font-bold">{fmtBRL(r.total)}</div>
      <PDFButtons onGet={buildPdf} filename={pdfFilename(r.data_inicio, r.data_fim, colab)} />
    </div>
  );
}

function PDFButtons({ onGet, filename }: { onGet: () => Promise<jsPDF> | jsPDF; filename: string }) {
  const [busy, setBusy] = useState<"share" | "save" | null>(null);
  const run = async (mode: "share" | "save") => {
    setBusy(mode);
    try {
      const doc = await onGet();
      if (mode === "share") await sharePDF(doc, filename);
      else savePDF(doc, filename);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="mt-4 grid grid-cols-2 gap-2">
      <Button variant="outline" onClick={() => run("share")} disabled={busy !== null}>
        <Share2 className="size-4 mr-1.5" /> Compartilhar
      </Button>
      <Button onClick={() => run("save")} disabled={busy !== null}>
        <Download className="size-4 mr-1.5" /> Salvar
      </Button>
    </div>
  );
}
