import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Check, ChevronDown, ChevronRight, ChevronUp, Download, FileText, Lock, Pencil, Share2, Trash2, Undo2, X,
} from "lucide-react";
import { toast } from "sonner";
import { fmtBRL, fmtDate } from "@/lib/format";
import { STORAGE_BUCKET, TIPOS_DESPESA } from "@/lib/constants";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/PageHeader";
import { isAdmin, useProfile } from "@/lib/profile";
import { buildDespesasPDF, colaboradorPdfFilename, savePDF, sharePDF } from "@/lib/pdf";

export const Route = createFileRoute("/_authenticated/despesas")({
  head: () => ({
    meta: [
      { title: "Despesas — Hubvision" },
      { name: "description", content: "Aprovações e lançamentos de despesas Hubvision." },
      { property: "og:title", content: "Despesas — Hubvision" },
      { property: "og:description", content: "Aprove, rejeite e acompanhe despesas corporativas." },
    ],
  }),
  component: DespesasPage,
});

interface Despesa {
  id: string;
  user_id: string;
  tipo_despesa: string;
  valor: number;
  data_despesa: string;
  descricao: string | null;
  foto_url: string | null;
  status: string;
  motivo_rejeicao: string | null;
  relatorio_id: string | null;
  created_at: string;
  colaborador: { nome: string } | null;
}

// "fechada" é derivado: despesa já incluída em fechamento concluído.
type StatusFilter = "todos" | "pendente" | "aprovado" | "rejeitado" | "fechada";

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "todos", label: "Todos os status" },
  { value: "pendente", label: "Pendentes" },
  { value: "aprovado", label: "Aprovadas (abertas)" },
  { value: "rejeitado", label: "Rejeitadas" },
  { value: "fechada", label: "Em fechamento" },
];

function DespesasPage() {
  const qc = useQueryClient();
  const profile = useProfile();
  const admin = isAdmin(profile);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>(admin ? "pendente" : "todos");
  const [colabFilter, setColabFilter] = useState<string>("todos");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<Despesa | null>(null);
  const [rejecting, setRejecting] = useState<Despesa | null>(null);

  const { data: colaboradores = [] } = useQuery({
    queryKey: ["profiles"],
    enabled: admin,
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, nome, ativo").order("nome");
      if (error) throw error;
      return data;
    },
  });

  const { data: despesas = [], isLoading } = useQuery<Despesa[]>({
    queryKey: ["despesas", "lista", statusFilter, admin ? colabFilter : profile.id],
    queryFn: async () => {
      let q = supabase
        .from("despesas")
        .select("*, colaborador:profiles!despesas_user_id_fkey(nome)")
        .order("data_despesa", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(500);
      if (!admin) q = q.eq("user_id", profile.id);
      else if (colabFilter !== "todos") q = q.eq("user_id", colabFilter);
      if (statusFilter === "fechada") q = q.not("relatorio_id", "is", null);
      else if (statusFilter !== "todos") q = q.eq("status", statusFilter).is("relatorio_id", null);
      const { data, error } = await q;
      if (error) throw error;
      return data as unknown as Despesa[];
    },
  });

  // Totais em aberto (fora de fechamento) para os cards de resumo e o resumo por colaborador.
  const { data: abertas = [] } = useQuery({
    queryKey: ["despesas", "abertas", admin ? "equipe" : profile.id],
    queryFn: async () => {
      let q = supabase.from("despesas").select("user_id, status, valor").is("relatorio_id", null).neq("status", "rejeitado");
      if (!admin) q = q.eq("user_id", profile.id);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });

  const resumo = useMemo(() => {
    const porColab = new Map<string, { pendente: number; qtdPendente: number; aprovado: number }>();
    let pending = 0, approved = 0;
    for (const d of abertas) {
      if (admin && colabFilter !== "todos" && d.user_id !== colabFilter) continue;
      const v = Number(d.valor);
      const c = porColab.get(d.user_id) ?? { pendente: 0, qtdPendente: 0, aprovado: 0 };
      if (d.status === "pendente") { pending += v; c.pendente += v; c.qtdPendente += 1; }
      else if (d.status === "aprovado") { approved += v; c.aprovado += v; }
      porColab.set(d.user_id, c);
    }
    return { pending, approved, porColab };
  }, [abertas, admin, colabFilter]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["despesas"] });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status, motivo }: { id: string; status: string; motivo?: string }) => {
      const { error } = await supabase
        .from("despesas")
        .update({ status, motivo_rejeicao: status === "rejeitado" ? motivo?.trim() || null : null })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, v) => {
      invalidate();
      setRejecting(null);
      toast.success(v.status === "aprovado" ? "Despesa aprovada" : v.status === "rejeitado" ? "Despesa rejeitada" : "Voltou para pendente");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteDespesa = useMutation({
    mutationFn: async (d: Despesa) => {
      const { error } = await supabase.from("despesas").delete().eq("id", d.id);
      if (error) throw error;
      if (d.foto_url) await supabase.storage.from(STORAGE_BUCKET).remove([d.foto_url]);
    },
    onSuccess: () => {
      invalidate();
      toast.success("Despesa excluída");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const colabSelecionado = colaboradores.find((c) => c.id === colabFilter);
  const nomeDe = (id: string) => colaboradores.find((c) => c.id === id)?.nome ?? "—";

  const gerarPdfColaborador = () => {
    const nome = colabSelecionado?.nome ?? "";
    const filtro = STATUS_OPTIONS.find((o) => o.value === statusFilter)?.label ?? "";
    return {
      doc: buildDespesasPDF({
        titulo: "Despesas do colaborador",
        meta: [`Colaborador: ${nome}`, `Filtro: ${filtro}`],
        despesas: despesas.map((d) => ({
          colaborador: nome,
          tipo_despesa: d.tipo_despesa,
          data_despesa: d.data_despesa,
          status: d.status,
          valor: Number(d.valor),
          descricao: d.descricao,
        })),
      }),
      filename: colaboradorPdfFilename(nome),
    };
  };

  return (
    <div className="px-4 pt-6 pb-4">
      <PageHeader title={admin ? "Despesas da equipe" : "Minhas despesas"} />

      <div className="grid grid-cols-2 gap-3 mb-4">
        <SummaryCard label="Pendente" value={resumo.pending} tone="pending" />
        <SummaryCard label="Aprovado (aberto)" value={resumo.approved} tone="approved" />
      </div>

      {admin && colabFilter === "todos" && resumo.porColab.size > 0 && (
        <div className="mb-4 rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="px-4 pt-3 pb-1 text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
            Por colaborador (em aberto)
          </div>
          <ul className="divide-y divide-border">
            {[...resumo.porColab.entries()]
              .sort((a, b) => nomeDe(a[0]).localeCompare(nomeDe(b[0]), "pt-BR"))
              .map(([id, c]) => (
                <li key={id}>
                  <button type="button" onClick={() => setColabFilter(id)}
                    className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/40 transition">
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">{nomeDe(id)}</div>
                      <div className="text-xs text-muted-foreground">
                        {c.qtdPendente > 0 ? `${c.qtdPendente} pendente(s) · ` : ""}
                        <span className="font-mono-ledger">aprovado {fmtBRL(c.aprovado)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {c.pendente > 0 && (
                        <span className="font-mono-ledger text-sm font-semibold text-[var(--color-status-pending)]">{fmtBRL(c.pendente)}</span>
                      )}
                      <ChevronRight className="size-4 text-muted-foreground" />
                    </div>
                  </button>
                </li>
              ))}
          </ul>
        </div>
      )}

      <div className={`grid gap-3 mb-4 ${admin ? "grid-cols-2" : "grid-cols-1"}`}>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((o) => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}
          </SelectContent>
        </Select>
        {admin && (
          <Select value={colabFilter} onValueChange={setColabFilter}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os colaboradores</SelectItem>
              {colaboradores.map((c) => (<SelectItem key={c.id} value={c.id}>{c.nome}{!c.ativo && " (inativo)"}</SelectItem>))}
            </SelectContent>
          </Select>
        )}
      </div>

      {admin && colabSelecionado && despesas.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => { const { doc, filename } = gerarPdfColaborador(); sharePDF(doc, filename); }}>
            <Share2 className="size-4 mr-1.5" /> Compartilhar PDF
          </Button>
          <Button variant="outline" onClick={() => { const { doc, filename } = gerarPdfColaborador(); savePDF(doc, filename); }}>
            <Download className="size-4 mr-1.5" /> Baixar PDF
          </Button>
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : despesas.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground text-sm">
          {admin && statusFilter === "pendente" ? "Nenhuma despesa aguardando aprovação." : "Nenhuma despesa encontrada."}
        </div>
      ) : (
        <div className="space-y-3">
          {despesas.map((d) => (
            <DespesaCard
              key={d.id}
              d={d}
              admin={admin}
              isOwner={d.user_id === profile.id}
              expanded={expanded === d.id}
              onToggle={() => setExpanded(expanded === d.id ? null : d.id)}
              busy={updateStatus.isPending}
              onApprove={() => updateStatus.mutate({ id: d.id, status: "aprovado" })}
              onReject={() => setRejecting(d)}
              onReopen={() => updateStatus.mutate({ id: d.id, status: "pendente" })}
              onEdit={() => setEditing(d)}
              onDelete={() => { if (confirm("Excluir esta despesa?")) deleteDespesa.mutate(d); }}
            />
          ))}
        </div>
      )}

      <EditDespesaDialog
        despesa={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          invalidate();
          toast.success("Despesa atualizada");
        }}
      />

      <RejectDialog
        despesa={rejecting}
        pending={updateStatus.isPending}
        onClose={() => setRejecting(null)}
        onConfirm={(motivo) => rejecting && updateStatus.mutate({ id: rejecting.id, status: "rejeitado", motivo })}
      />
    </div>
  );
}

function RejectDialog({
  despesa, pending, onClose, onConfirm,
}: {
  despesa: Despesa | null; pending: boolean; onClose: () => void; onConfirm: (motivo: string) => void;
}) {
  const [motivo, setMotivo] = useState("");
  useEffect(() => { if (despesa) setMotivo(""); }, [despesa]);

  return (
    <Dialog open={!!despesa} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Rejeitar despesa</DialogTitle></DialogHeader>
        {despesa && (
          <p className="text-sm text-muted-foreground">
            {despesa.tipo_despesa} · {despesa.colaborador?.nome} · <span className="font-mono-ledger">{fmtBRL(despesa.valor)}</span>
          </p>
        )}
        <div className="space-y-1.5">
          <Label>Motivo (o colaborador verá esta mensagem)</Label>
          <Textarea rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: nota fiscal ilegível" autoFocus />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => onConfirm(motivo)} disabled={pending}
            className="bg-[var(--color-status-rejected)] hover:bg-[var(--color-status-rejected)]/90 text-white">
            Rejeitar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditDespesaDialog({
  despesa, onClose, onSaved,
}: {
  despesa: Despesa | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<null | {
    tipo_despesa: string;
    valor: string; data_despesa: string; descricao: string;
  }>(null);

  useEffect(() => {
    setForm(
      despesa
        ? {
            tipo_despesa: despesa.tipo_despesa,
            valor: String(despesa.valor).replace(".", ","),
            data_despesa: despesa.data_despesa,
            descricao: despesa.descricao ?? "",
          }
        : null,
    );
  }, [despesa]);

  const save = useMutation({
    mutationFn: async () => {
      if (!despesa || !form) return;
      const valor = Number(form.valor.replace(",", "."));
      if (!Number.isFinite(valor) || valor <= 0) throw new Error("Informe um valor válido");
      const { error } = await supabase
        .from("despesas")
        .update({
          tipo_despesa: form.tipo_despesa,
          valor,
          data_despesa: form.data_despesa,
          descricao: form.descricao.trim() || null,
        })
        .eq("id", despesa.id);
      if (error) throw error;
    },
    onSuccess: onSaved,
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={!!despesa} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Editar despesa</DialogTitle></DialogHeader>
        {form && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select value={form.tipo_despesa} onValueChange={(v) => setForm({ ...form, tipo_despesa: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIPOS_DESPESA.map((t) => (<SelectItem key={t} value={t}>{t}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label>Valor (R$)</Label>
                <Input inputMode="decimal" className="font-mono-ledger" value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Data</Label>
                <Input type="date" className="font-mono-ledger" value={form.data_despesa} onChange={(e) => setForm({ ...form, data_despesa: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Descrição</Label>
              <Textarea rows={3} value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: "pending" | "approved" }) {
  const bg = tone === "pending" ? "bg-[var(--color-status-pending-bg)]" : "bg-[var(--color-status-approved-bg)]";
  const fg = tone === "pending" ? "text-[var(--color-status-pending)]" : "text-[var(--color-status-approved)]";
  return (
    <div className={`rounded-2xl border border-border ${bg} p-4`}>
      <div className={`text-[11px] uppercase tracking-wider font-semibold ${fg}`}>{label}</div>
      <div className={`mt-1 text-xl font-mono-ledger font-semibold ${fg}`}>{fmtBRL(value)}</div>
    </div>
  );
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    pendente: "bg-[var(--color-status-pending-bg)] text-[var(--color-status-pending)]",
    aprovado: "bg-[var(--color-status-approved-bg)] text-[var(--color-status-approved)]",
    rejeitado: "bg-[var(--color-status-rejected-bg)] text-[var(--color-status-rejected)]",
    fechada: "bg-muted text-foreground/70",
  };
  return `inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${map[status] || ""}`;
}

function DespesaCard({
  d, admin, isOwner, expanded, onToggle, busy, onApprove, onReject, onReopen, onEdit, onDelete,
}: {
  d: Despesa; admin: boolean; isOwner: boolean; expanded: boolean; onToggle: () => void; busy: boolean;
  onApprove: () => void; onReject: () => void; onReopen: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const locked = d.relatorio_id !== null;
  const canEdit = !locked && (admin || (isOwner && d.status === "pendente"));
  const [signed, setSigned] = useState<string | null>(null);

  // Carrega o anexo ao abrir o card (URL assinada, bucket privado).
  useEffect(() => {
    if (!expanded || !d.foto_url || signed) return;
    supabase.storage.from(STORAGE_BUCKET).createSignedUrl(d.foto_url, 3600).then(({ data }) => {
      if (data?.signedUrl) setSigned(data.signedUrl);
    });
  }, [expanded, d.foto_url, signed]);

  return (
    <div className="rounded-[14px] border border-border bg-card overflow-hidden shadow-sm">
      <button type="button" onClick={onToggle} className="w-full text-left p-4 hover:bg-muted/40 transition">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm truncate">{d.tipo_despesa}</span>
              <span className={statusBadge(locked ? "fechada" : d.status)}>{locked ? "fechada" : d.status}</span>
              {locked && <Lock className="size-3 text-muted-foreground" aria-label="Bloqueada" />}
              {d.foto_url && <FileText className="size-3 text-muted-foreground" aria-label="Com anexo" />}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {admin && <>{d.colaborador?.nome ?? "—"} · </>}
              <span className="font-mono-ledger">{fmtDate(d.data_despesa)}</span>
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="font-mono-ledger font-bold text-base">{fmtBRL(d.valor)}</div>
            <div className="mt-1 text-muted-foreground">
              {expanded ? <ChevronUp className="size-4 inline" /> : <ChevronDown className="size-4 inline" />}
            </div>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4">
          <hr className="receipt-divider" />
          {d.status === "rejeitado" && (
            <div className="mb-3 rounded-lg bg-[var(--color-status-rejected-bg)] p-2.5 text-xs text-[var(--color-status-rejected)]">
              <span className="font-semibold">Rejeitada{d.motivo_rejeicao ? ": " : ""}</span>
              {d.motivo_rejeicao}
            </div>
          )}
          {d.descricao && <p className="text-sm text-foreground/80 mb-3 whitespace-pre-wrap">{d.descricao}</p>}
          {d.foto_url && (
            <div className="mb-3">
              {!signed ? (
                <p className="text-xs text-muted-foreground">Carregando anexo…</p>
              ) : d.foto_url.endsWith(".pdf") ? (
                <a href={signed} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-sm font-medium">
                  <FileText className="size-4" /> Abrir PDF da nota
                </a>
              ) : (
                <a href={signed} target="_blank" rel="noreferrer">
                  <img src={signed} alt="Nota fiscal" className="w-full max-h-72 object-contain rounded-lg border border-border bg-muted" />
                </a>
              )}
            </div>
          )}
          {!d.foto_url && <p className="text-xs text-muted-foreground mb-3">Sem nota anexada.</p>}

          {locked ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground rounded-lg bg-muted p-2.5">
              <Lock className="size-3.5" />
              Incluída em fechamento concluído
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {admin && d.status !== "aprovado" && (
                <Button size="sm" onClick={onApprove} disabled={busy}
                  className="bg-[var(--color-status-approved)] hover:bg-[var(--color-status-approved)]/90 text-white">
                  <Check className="size-4 mr-1" /> Aprovar
                </Button>
              )}
              {admin && d.status !== "rejeitado" && (
                <Button size="sm" variant="outline" onClick={onReject} disabled={busy}
                  className="border-[var(--color-status-rejected)] text-[var(--color-status-rejected)] hover:bg-[var(--color-status-rejected-bg)]">
                  <X className="size-4 mr-1" /> Rejeitar
                </Button>
              )}
              {admin && d.status !== "pendente" && (
                <Button size="sm" variant="ghost" onClick={onReopen} disabled={busy}>
                  <Undo2 className="size-4 mr-1" /> Voltar para pendente
                </Button>
              )}
              {canEdit && (
                <>
                  <Button size="sm" variant="outline" onClick={onEdit}>
                    <Pencil className="size-4 mr-1" /> Editar
                  </Button>
                  <Button size="sm" variant="ghost" onClick={onDelete}>
                    <Trash2 className="size-4 mr-1" /> Excluir
                  </Button>
                </>
              )}
              {!admin && !canEdit && (
                <p className="text-xs text-muted-foreground">Despesa já avaliada — não pode mais ser alterada.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
