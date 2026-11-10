import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Camera, X, Upload, FileText, Loader2, Sparkles, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { TIPOS_DESPESA, STORAGE_BUCKET } from "@/lib/constants";
import { today } from "@/lib/format";
import { compressImage } from "@/lib/image";
import { useNavigate } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { useProfile } from "@/lib/profile";
import { lerComprovante } from "@/lib/comprovante.functions";

type Leitura =
  | { status: "lendo" }
  | { status: "ok"; faltando: string[] }
  | { status: "falhou"; motivo: string };

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export const Route = createFileRoute("/_authenticated/nova")({
  head: () => ({
    meta: [
      { title: "Nova despesa — Hubvision" },
      { name: "description", content: "Lance uma nova despesa corporativa Hubvision." },
      { property: "og:title", content: "Nova despesa — Hubvision" },
      { property: "og:description", content: "Registre despesas corporativas com foto da nota fiscal." },
    ],
  }),
  component: NovaDespesa,
});

function NovaDespesa() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const cameraInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const profile = useProfile();

  const [tipo, setTipo] = useState<string>("");
  const [valor, setValor] = useState<string>("");
  const [dataDespesa, setDataDespesa] = useState<string>(today());
  const [descricao, setDescricao] = useState<string>("");
  const [photoFile, setPhotoFile] = useState<Blob | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [fileMeta, setFileMeta] = useState<{ name: string; type: string; ext: string } | null>(null);

  const [leitura, setLeitura] = useState<Leitura | null>(null);
  // Identifica a leitura em andamento: se o usuário trocar ou remover o arquivo, a resposta antiga é descartada.
  const leituraId = useRef(0);

  useEffect(() => {
    return () => { if (photoPreview) URL.revokeObjectURL(photoPreview); };
  }, [photoPreview]);

  // A IA só sugere: preenche os campos e o usuário confere antes de lançar.
  const analisar = async (blob: Blob, mimeType: string) => {
    const id = ++leituraId.current;
    setLeitura({ status: "lendo" });
    try {
      const r = await lerComprovante({ data: { base64: await toBase64(blob), mimeType } });
      if (id !== leituraId.current) return;
      if (!r.eComprovante) {
        setLeitura({ status: "falhou", motivo: "Isso não parece um comprovante legível. Preencha os dados manualmente ou tire outra foto." });
        return;
      }
      if (r.tipo) setTipo(r.tipo);
      if (r.valor != null) setValor(r.valor.toFixed(2).replace(".", ","));
      if (r.data) setDataDespesa(r.data);
      if (r.descricao) setDescricao((atual) => atual.trim() ? atual : r.descricao!);
      const faltando = [!r.tipo && "tipo", r.valor == null && "valor", !r.data && "data"].filter(Boolean) as string[];
      setLeitura({ status: "ok", faltando });
    } catch (e) {
      if (id !== leituraId.current) return;
      setLeitura({ status: "falhou", motivo: e instanceof Error ? e.message : "Não foi possível ler o comprovante. Preencha manualmente." });
    }
  };

  const handleFile = async (f: File) => {
    try {
      if (photoPreview) URL.revokeObjectURL(photoPreview);
      if (f.type.startsWith("image/")) {
        // Resolução suficiente para a IA ler valores pequenos do cupom.
        const blob = await compressImage(f, 1600, 0.75);
        setPhotoFile(blob);
        setPhotoPreview(URL.createObjectURL(blob));
        setFileMeta({ name: f.name, type: "image/jpeg", ext: "jpg" });
        void analisar(blob, "image/jpeg");
      } else if (f.type === "application/pdf") {
        if (f.size > 10 * 1024 * 1024) { toast.error("Arquivo muito grande (máx. 10 MB)"); return; }
        setPhotoFile(f);
        setPhotoPreview(null);
        setFileMeta({ name: f.name, type: "application/pdf", ext: "pdf" });
        void analisar(f, "application/pdf");
      } else {
        toast.error("Envie uma imagem ou PDF");
      }
    } catch {
      toast.error("Não foi possível processar o arquivo");
    }
  };

  const clearFile = () => {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoFile(null);
    setPhotoPreview(null);
    setFileMeta(null);
    leituraId.current++;
    setLeitura(null);
  };

  const submit = useMutation({
    mutationFn: async () => {
      let foto_url: string | null = null;
      if (photoFile) {
        // A pasta do usuário é exigida pela política do bucket.
        const path = `${profile.id}/${crypto.randomUUID()}.${fileMeta?.ext ?? "jpg"}`;
        const { error: upErr } = await supabase.storage.from(STORAGE_BUCKET).upload(path, photoFile, {
          contentType: fileMeta?.type ?? "image/jpeg",
          upsert: false,
        });
        if (upErr) throw upErr;
        foto_url = path;
      }
      const { error } = await supabase.from("despesas").insert({
        tipo_despesa: tipo,
        valor: parseFloat(valor.replace(",", ".")),
        data_despesa: dataDespesa,
        descricao: descricao.trim() || null,
        foto_url,
      });
      if (error) {
        if (foto_url) await supabase.storage.from(STORAGE_BUCKET).remove([foto_url]);
        throw error;
      }
    },
    onSuccess: () => {
      toast.success("Despesa lançada!");
      qc.invalidateQueries({ queryKey: ["despesas"] });
      clearFile();
      navigate({ to: "/despesas" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const canSubmit = tipo && valor && parseFloat(valor.replace(",", ".")) > 0;

  return (
    <div className="px-4 pt-6 pb-4">
      <PageHeader title="Nova despesa" />

      <form
        onSubmit={(e) => { e.preventDefault(); if (canSubmit && !submit.isPending && leitura?.status !== "lendo") submit.mutate(); }}
        className="space-y-5 rounded-2xl border border-border bg-card p-5 shadow-sm"
      >
        <div className="space-y-1.5">
          <Label>Comprovante</Label>
          {!fileMeta && (
            <p className="text-xs text-muted-foreground">Comece pela foto ou arquivo: os dados são preenchidos automaticamente para você conferir.</p>
          )}
          <input
            ref={cameraInput} type="file" accept="image/*" capture="environment" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
          />
          <input
            ref={fileInput} type="file" accept="image/*,application/pdf" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
          />
          {!fileMeta ? (
            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={() => cameraInput.current?.click()}
                className="h-32 rounded-xl border-2 border-dashed border-border bg-muted/40 hover:bg-muted transition flex flex-col items-center justify-center gap-2 text-muted-foreground">
                <Camera className="size-7" />
                <span className="text-sm font-medium">Tirar foto</span>
              </button>
              <button type="button" onClick={() => fileInput.current?.click()}
                className="h-32 rounded-xl border-2 border-dashed border-border bg-muted/40 hover:bg-muted transition flex flex-col items-center justify-center gap-2 text-muted-foreground">
                <Upload className="size-7" />
                <span className="text-sm font-medium text-center px-2">Escolher arquivo ou foto</span>
                <span className="text-[11px]">Galeria · PDF</span>
              </button>
            </div>
          ) : (
            <div className="relative rounded-xl overflow-hidden border border-border">
              {photoPreview ? (
                <img src={photoPreview} alt="Prévia da nota" className="w-full max-h-64 object-contain bg-muted" />
              ) : (
                <div className="flex items-center gap-3 p-4 bg-muted">
                  <FileText className="size-8 text-muted-foreground shrink-0" />
                  <span className="text-sm font-medium truncate">{fileMeta.name}</span>
                </div>
              )}
              <div className="flex flex-wrap gap-2 p-2 bg-card border-t border-border">
                <Button type="button" variant="outline" size="sm" onClick={() => cameraInput.current?.click()}>Tirar foto</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()}>Escolher arquivo</Button>
                <Button type="button" variant="ghost" size="sm" onClick={clearFile}>
                  <X className="size-4 mr-1" /> Remover
                </Button>
              </div>
            </div>
          )}
          {leitura?.status === "lendo" && (
            <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground" role="status">
              <Loader2 className="size-4 animate-spin shrink-0" /> Lendo o comprovante…
            </div>
          )}
          {leitura?.status === "ok" && (
            <div className="flex items-start gap-2 rounded-lg bg-[var(--color-gold-soft)] px-3 py-2 text-sm text-[var(--color-ink)]" role="status">
              <Sparkles className="size-4 shrink-0 mt-0.5" />
              <span>
                Dados preenchidos automaticamente. Confira antes de lançar.
                {leitura.faltando.length > 0 && ` Não consegui ler: ${leitura.faltando.join(", ")}.`}
              </span>
            </div>
          )}
          {leitura?.status === "falhou" && (
            <div className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-foreground/80" role="status">
              <TriangleAlert className="size-4 shrink-0 mt-0.5" />
              <span>{leitura.motivo}</span>
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <Label>Tipo de despesa</Label>
          <Select value={tipo} onValueChange={setTipo}>
            <SelectTrigger><SelectValue placeholder="Selecione o tipo" /></SelectTrigger>
            <SelectContent>
              {TIPOS_DESPESA.map((t) => (<SelectItem key={t} value={t}>{t}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Valor (R$)</Label>
            <Input inputMode="decimal" placeholder="0,00" className="font-mono-ledger"
              value={valor} onChange={(e) => setValor(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Data</Label>
            <Input type="date" className="font-mono-ledger" value={dataDespesa} onChange={(e) => setDataDespesa(e.target.value)} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Descrição / Observações</Label>
          <Textarea rows={3} value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Opcional" />
        </div>

        <Button type="submit" disabled={!canSubmit || submit.isPending || leitura?.status === "lendo"} className="w-full h-12 text-base font-semibold">
          {submit.isPending ? "Enviando…" : leitura?.status === "ok" ? "Confirmar e lançar" : "Lançar despesa"}
        </Button>
      </form>

    </div>
  );
}

