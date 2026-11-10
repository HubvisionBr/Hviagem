import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { fmtBRL, fmtDate } from "./format";

export interface DespesaRow {
  colaborador: string;
  tipo_despesa: string;
  data_despesa: string;
  status: string;
  valor: number;
  descricao?: string | null;
}

interface Args {
  /** Ex.: "Relatório de Fechamento" ou "Despesas do colaborador" */
  titulo: string;
  /** Linhas de contexto abaixo do cabeçalho (período, colaborador, data de conclusão…) */
  meta: string[];
  despesas: DespesaRow[];
}

const INK: [number, number, number] = [18, 33, 59]; // #12213B
const PAPER: [number, number, number] = [238, 241, 246]; // #EEF1F6
const GOLD_SOFT: [number, number, number] = [244, 227, 184]; // #F4E3B8

const STATUS_LABEL: Record<string, string> = {
  pendente: "Pendente",
  aprovado: "Aprovado",
  rejeitado: "Rejeitado",
};

function lastY(doc: jsPDF) {
  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
}

/**
 * Relatório de despesas agrupado por colaborador: resumo por colaborador no topo
 * (quando há mais de um), depois uma tabela por colaborador com subtotal, e o total geral.
 */
export function buildDespesasPDF({ titulo, meta, despesas }: Args) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = { left: 40, right: 40 };

  doc.setFillColor(...INK);
  doc.rect(0, 0, pageWidth, 72, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Hubvision", 40, 34);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(titulo, 40, 54);

  doc.setTextColor(...INK);
  doc.setFontSize(10);
  let y = 100;
  for (const line of meta) {
    doc.text(line, 40, y);
    y += 16;
  }

  const grupos = new Map<string, DespesaRow[]>();
  for (const d of despesas) {
    const g = grupos.get(d.colaborador) ?? [];
    g.push(d);
    grupos.set(d.colaborador, g);
  }
  const nomes = [...grupos.keys()].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const soma = (rows: DespesaRow[]) => rows.reduce((a, d) => a + d.valor, 0);
  const total = soma(despesas);

  if (nomes.length > 1) {
    autoTable(doc, {
      startY: y + 8,
      head: [["Resumo por colaborador", "Qtd.", "Total"]],
      body: nomes.map((n) => [n, String(grupos.get(n)!.length), fmtBRL(soma(grupos.get(n)!))]),
      foot: [["Total geral", String(despesas.length), fmtBRL(total)]],
      headStyles: { fillColor: INK, textColor: 255, fontStyle: "bold", fontSize: 9 },
      footStyles: { fillColor: GOLD_SOFT, textColor: INK, fontStyle: "bold", fontSize: 10 },
      bodyStyles: { fontSize: 9, textColor: [30, 30, 30] },
      alternateRowStyles: { fillColor: PAPER },
      columnStyles: { 1: { halign: "center", cellWidth: 50 }, 2: { halign: "right", cellWidth: 110 } },
      margin,
    });
    y = lastY(doc) + 10;
  }

  for (const nome of nomes) {
    const rows = [...grupos.get(nome)!].sort((a, b) => a.data_despesa.localeCompare(b.data_despesa));
    autoTable(doc, {
      startY: y + 14,
      head: [[{ content: nome, colSpan: 4, styles: { halign: "left", fontSize: 10 } }], ["Data", "Tipo", "Status", "Valor"]],
      body: rows.map((d) => [
        fmtDate(d.data_despesa),
        d.descricao ? `${d.tipo_despesa}\n${d.descricao}` : d.tipo_despesa,
        STATUS_LABEL[d.status] ?? d.status,
        fmtBRL(d.valor),
      ]),
      foot: [[{ content: `Subtotal · ${rows.length} despesa(s)`, colSpan: 3 }, fmtBRL(soma(rows))]],
      headStyles: { fillColor: INK, textColor: 255, fontStyle: "bold", fontSize: 9 },
      footStyles: { fillColor: PAPER, textColor: INK, fontStyle: "bold", fontSize: 9 },
      bodyStyles: { fontSize: 9, textColor: [30, 30, 30], valign: "top" },
      alternateRowStyles: { fillColor: [248, 249, 251] },
      columnStyles: { 0: { cellWidth: 62 }, 2: { cellWidth: 62 }, 3: { halign: "right", fontStyle: "bold", cellWidth: 80 } },
      margin,
    });
    y = lastY(doc);
  }

  if (y + 40 > doc.internal.pageSize.getHeight() - 30) {
    doc.addPage();
    y = 40;
  }
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`Quantidade de despesas: ${despesas.length}`, 40, y + 24);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(`Total: ${fmtBRL(total)}`, pageWidth - 40, y + 24, { align: "right" });

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(
      `Gerado em ${new Date().toLocaleString("pt-BR")} · Página ${i} de ${pages}`,
      pageWidth / 2,
      doc.internal.pageSize.getHeight() - 16,
      { align: "center" },
    );
  }

  return doc;
}

const slug = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function pdfFilename(dataInicio: string, dataFim: string, colaborador?: string | null): string {
  const quem = colaborador ? `-${slug(colaborador)}` : "";
  return `fechamento-hubvision${quem}-${dataInicio}_a_${dataFim}.pdf`;
}

export function colaboradorPdfFilename(colaborador: string): string {
  return `despesas-${slug(colaborador)}-${new Date().toISOString().slice(0, 10)}.pdf`;
}

export async function sharePDF(doc: jsPDF, filename: string) {
  const blob = doc.output("blob");
  const file = new File([blob], filename, { type: "application/pdf" });
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (nav.canShare && nav.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
    }
  }
  doc.save(filename);
}

export function savePDF(doc: jsPDF, filename: string) {
  doc.save(filename);
}
