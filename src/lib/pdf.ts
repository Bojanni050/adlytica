import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { savePdf } from "./api";

export interface PdfKpi { label: string; value: string }

export interface PdfSection {
  title: string;
  head: string[];
  rows: (string | number)[][];
  note?: string;
}

export interface PdfReport {
  title: string;
  subtitle?: string;
  kpis?: PdfKpi[];
  sections: PdfSection[];
  filename?: string;
}

const ACCENT: [number, number, number] = [245, 158, 11];
const INK: [number, number, number] = [27, 18, 6];
const MUTED: [number, number, number] = [120, 130, 145];
const NAVY: [number, number, number] = [13, 17, 23];
const TEXT: [number, number, number] = [40, 45, 55];
const STROKE: [number, number, number] = [226, 230, 236];
const ZEBRA: [number, number, number] = [247, 248, 250];

/**
 * Bouwt een rapport-PDF en schrijft die via Rust naar de map Downloads.
 * Geeft het volledige pad terug, zodat de UI kan melden waar het bestand staat.
 */
export async function exportPdf(report: PdfReport): Promise<string> {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const margin = 40;

  // Kop
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, width, 92, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...ACCENT);
  doc.text("ADLYTICA", margin, 30);

  doc.setFontSize(20);
  doc.setTextColor(236, 240, 246);
  const titleLines = doc.splitTextToSize(report.title, width - margin * 2);
  doc.text(titleLines, margin, 56);

  if (report.subtitle) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(150, 162, 178);
    doc.text(String(report.subtitle), margin, 76);
  }

  let cursor = 120;

  // Kerncijfers in een raster van drie
  if (report.kpis && report.kpis.length > 0) {
    const perRow = 3;
    const columnWidth = (width - margin * 2) / perRow;
    report.kpis.forEach((kpi, index) => {
      const row = Math.floor(index / perRow);
      const column = index % perRow;
      const x = margin + column * columnWidth;
      const y = cursor + row * 52;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...MUTED);
      doc.text(kpi.label.toUpperCase(), x, y);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.setTextColor(...TEXT);
      doc.text(kpi.value, x, y + 20);
    });
    cursor += Math.ceil(report.kpis.length / perRow) * 52 + 8;
  }

  // Tabellen
  for (const section of report.sections) {
    if (cursor > height - 120) {
      doc.addPage();
      cursor = 60;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...TEXT);
    doc.text(section.title, margin, cursor);
    cursor += 10;

    autoTable(doc, {
      head: [section.head],
      body: section.rows.map((row) => row.map((cell) => String(cell))),
      startY: cursor,
      margin: { left: margin, right: margin, top: 60 },
      theme: "grid",
      styles: {
        font: "helvetica",
        fontSize: 8.5,
        cellPadding: 5,
        textColor: TEXT,
        lineColor: STROKE,
        lineWidth: 0.5,
        overflow: "linebreak",
      },
      headStyles: { fillColor: ACCENT, textColor: INK, fontStyle: "bold", fontSize: 8.5 },
      alternateRowStyles: { fillColor: ZEBRA },
    });

    const finalY = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY;
    cursor = (finalY ?? cursor) + (section.note ? 14 : 22);

    if (section.note) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8);
      doc.setTextColor(...MUTED);
      doc.text(section.note, margin, cursor);
      cursor += 20;
    }
  }

  // Voettekst op elke pagina
  const pages = doc.getNumberOfPages();
  const stamp = new Date().toLocaleString("nl-NL", { dateStyle: "short", timeStyle: "short" });
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(`Adlytica · ${stamp}`, margin, height - 24);
    doc.text(`${page} / ${pages}`, width - margin, height - 24, { align: "right" });
  }

  const bytes = Array.from(new Uint8Array(doc.output("arraybuffer") as ArrayBuffer));
  const fallback = `adlytica-${new Date().toISOString().slice(0, 10)}.pdf`;
  return savePdf(report.filename ?? fallback, bytes);
}
