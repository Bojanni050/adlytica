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

/** Extra regels op de voorpagina, bijvoorbeeld Periode of Bevroren op. */
export interface PdfMeta { label: string; value: string }

/** Wit-label: alleen naam en accentkleur, de rest houdt hetzelfde sjabloon. */
export interface PdfBrand { name?: string; accent?: string; footer?: string }

export interface PdfReport {
  title: string;
  subtitle?: string;
  kpis?: PdfKpi[];
  sections: PdfSection[];
  meta?: PdfMeta[];
  brand?: PdfBrand;
  filename?: string;
}

type Rgb = [number, number, number];

const DEFAULT_ACCENT: Rgb = [245, 158, 11];
const NAVY: Rgb = [13, 17, 23];
const TEXT: Rgb = [40, 45, 55];
const MUTED: Rgb = [122, 132, 146];
const STROKE: Rgb = [225, 229, 235];
const ZEBRA: Rgb = [247, 248, 250];
const PANEL: Rgb = [250, 250, 251];

function parseHex(value?: string): Rgb | null {
  if (!value) return null;
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const int = parseInt(match[1], 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

function oneLine(doc: jsPDF, text: string, maxWidth: number): string {
  const lines = doc.splitTextToSize(text, maxWidth) as string[];
  return lines[0] ?? "";
}

/** Kolommen die volledig uit getallen, bedragen of percentages bestaan, rechts uitlijnen. */
function numericColumns(rows: (string | number)[][]): Record<number, { halign: "right" }> {
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const styles: Record<number, { halign: "right" }> = {};
  for (let column = 0; column < width; column += 1) {
    const cells = rows.map((row) => String(row[column] ?? "").trim());
    if (cells.length === 0 || cells.some((cell) => cell === "")) continue;
    if (cells.every((cell) => /^[€$+-]?\s*\d[\d.,\s]*\s*%?$/.test(cell))) {
      styles[column] = { halign: "right" };
    }
  }
  return styles;
}

/**
 * Bouwt een rapport-PDF en schrijft die via Rust naar de map Downloads.
 * Geeft het volledige pad terug, zodat de UI kan melden waar het bestand staat.
 *
 * Opbouw: voorpagina met titel, periode en inhoudsopgave, daarna inhoudspagina's
 * met een vaste kopregel, kerncijfers als kaarten en genummerde tabellen.
 */
export async function exportPdf(report: PdfReport): Promise<string> {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 48;
  const contentWidth = pageWidth - margin * 2;

  const brandName = (report.brand?.name?.trim() || "Adlytica").toUpperCase();
  const brandLabel = report.brand?.name?.trim() || "Adlytica";
  const accent = parseHex(report.brand?.accent) ?? DEFAULT_ACCENT;
  const footerLeft = report.brand?.footer?.trim() || `Opgesteld met ${brandLabel}`;
  const generatedAt = new Date();
  const generatedLabel = generatedAt.toLocaleString("nl-NL", { dateStyle: "long", timeStyle: "short" });
  const shortTitle = oneLine(doc, report.title, contentWidth - 120);

  // ── Voorpagina ────────────────────────────────────────────────────────────
  doc.setFillColor(...accent);
  doc.rect(0, 0, pageWidth, 8, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setCharSpace(1.2);
  doc.setTextColor(...accent);
  doc.text(brandName, margin, 64);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text("RAPPORT", pageWidth - margin, 64, { align: "right" });
  doc.setCharSpace(0);

  const titleLines = doc.splitTextToSize(report.title, contentWidth) as string[];
  doc.setFont("helvetica", "bold");
  doc.setFontSize(28);
  doc.setTextColor(...NAVY);
  doc.text(titleLines, margin, 178);

  const titleBottom = 178 + (titleLines.length - 1) * 34;

  doc.setFillColor(...accent);
  doc.rect(margin, titleBottom + 18, 56, 3, "F");

  let coverCursor = titleBottom + 44;
  if (report.subtitle) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(...MUTED);
    const subtitleLines = doc.splitTextToSize(report.subtitle, contentWidth - 40) as string[];
    doc.text(subtitleLines, margin, coverCursor);
    coverCursor += subtitleLines.length * 16 + 20;
  }

  // Periode, moment van maken enzovoort, als rustige label/waarde-regels.
  const meta = report.meta ?? [];
  if (meta.length > 0) {
    coverCursor = Math.max(coverCursor + 12, 372);
    for (const row of meta.slice(0, 6)) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(...MUTED);
      doc.setCharSpace(0.8);
      doc.text(row.label.toUpperCase(), margin, coverCursor);
      doc.setCharSpace(0);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10.5);
      doc.setTextColor(...TEXT);
      doc.text(oneLine(doc, row.value, contentWidth - 40), margin, coverCursor + 15);
      coverCursor += 38;
    }
  }

  // Inhoudsopgave; zonder paginanummers, want die staan pas vast na het opbouwen.
  const overviewTop = Math.max(coverCursor + 18, 520);
  if (report.sections.length > 0 && overviewTop < pageHeight - 140) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.setCharSpace(0.8);
    doc.text("INHOUD", margin, overviewTop);
    doc.setCharSpace(0);

    doc.setDrawColor(...STROKE);
    doc.setLineWidth(0.6);
    doc.line(margin, overviewTop + 8, margin + contentWidth, overviewTop + 8);

    const maxItems = Math.max(1, Math.floor((pageHeight - 130 - (overviewTop + 26)) / 20));
    const items = report.sections.slice(0, maxItems);
    items.forEach((section, index) => {
      const y = overviewTop + 30 + index * 20;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(...accent);
      doc.text(String(index + 1).padStart(2, "0"), margin, y);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(...TEXT);
      doc.text(oneLine(doc, section.title, contentWidth - 40), margin + 22, y);
    });
    if (report.sections.length > items.length) {
      doc.setFontSize(8);
      doc.setTextColor(...MUTED);
      doc.text(
        `+ ${report.sections.length - items.length} blokken`,
        margin + 22,
        overviewTop + 30 + items.length * 20
      );
    }
  }

  doc.setDrawColor(...STROKE);
  doc.setLineWidth(0.6);
  doc.line(margin, pageHeight - 58, pageWidth - margin, pageHeight - 58);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text(footerLeft, margin, pageHeight - 38);
  doc.text(generatedLabel, pageWidth - margin, pageHeight - 38, { align: "right" });

  // ── Inhoudspagina's ───────────────────────────────────────────────────────
  doc.addPage();
  let cursor = 96;

  if (report.kpis && report.kpis.length > 0) {
    const perRow = 3;
    const gap = 12;
    const cardWidth = (contentWidth - gap * (perRow - 1)) / perRow;
    const cardHeight = 58;

    report.kpis.forEach((kpi, index) => {
      const row = Math.floor(index / perRow);
      const column = index % perRow;
      const x = margin + column * (cardWidth + gap);
      const y = cursor + row * (cardHeight + gap);

      doc.setFillColor(...PANEL);
      doc.setDrawColor(...STROKE);
      doc.setLineWidth(0.6);
      doc.roundedRect(x, y, cardWidth, cardHeight, 4, 4, "FD");

      doc.setFillColor(...accent);
      doc.rect(x + 10, y, Math.min(28, cardWidth - 20), 2.5, "F");

      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(...MUTED);
      doc.setCharSpace(0.4);
      doc.text(oneLine(doc, kpi.label.toUpperCase(), cardWidth - 20), x + 10, y + 20);
      doc.setCharSpace(0);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(15);
      doc.setTextColor(...NAVY);
      doc.text(oneLine(doc, kpi.value, cardWidth - 20), x + 10, y + 43);
    });

    cursor += Math.ceil(report.kpis.length / perRow) * (cardHeight + gap) + 10;
  }

  report.sections.forEach((section, index) => {
    if (cursor > pageHeight - 170) {
      doc.addPage();
      cursor = 96;
    }

    // Sectiekop: nummer, titel, dunne lijn.
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...accent);
    doc.text(String(index + 1).padStart(2, "0"), margin, cursor);

    const headingLines = doc.splitTextToSize(section.title, contentWidth - 30) as string[];
    doc.setFontSize(12.5);
    doc.setTextColor(...NAVY);
    doc.text(headingLines, margin + 24, cursor);

    const headingBottom = cursor + (headingLines.length - 1) * 16;
    doc.setDrawColor(...STROKE);
    doc.setLineWidth(0.6);
    doc.line(margin, headingBottom + 8, margin + contentWidth, headingBottom + 8);
    cursor = headingBottom + 22;

    autoTable(doc, {
      head: [section.head],
      body: section.rows.map((row) => row.map((cell) => String(cell))),
      startY: cursor,
      margin: { left: margin, right: margin, top: 84 },
      theme: "grid",
      styles: {
        font: "helvetica",
        fontSize: 8.5,
        cellPadding: { top: 5, bottom: 5, left: 6, right: 6 },
        textColor: TEXT,
        lineColor: STROKE,
        lineWidth: 0.4,
        overflow: "linebreak",
      },
      headStyles: { fillColor: NAVY, textColor: [236, 240, 246], fontStyle: "bold", fontSize: 8 },
      alternateRowStyles: { fillColor: ZEBRA },
      columnStyles: numericColumns(section.rows),
    });

    const finalY = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY;
    cursor = (finalY ?? cursor) + 18;

    if (section.note) {
      const lines = doc.splitTextToSize(section.note, contentWidth - 26) as string[];
      const noteHeight = lines.length * 11 + 12;
      if (cursor + noteHeight > pageHeight - 70) {
        doc.addPage();
        cursor = 96;
      }
      doc.setFillColor(...PANEL);
      doc.rect(margin, cursor, contentWidth, noteHeight, "F");
      doc.setFillColor(...accent);
      doc.rect(margin, cursor, 2, noteHeight, "F");
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8);
      doc.setTextColor(...MUTED);
      doc.text(lines, margin + 12, cursor + 13, { lineHeightFactor: 1.35 });
      cursor += noteHeight + 20;
    } else {
      cursor += 8;
    }
  });

  // ── Kop- en voettekst op alle inhoudspagina's ─────────────────────────────
  const pages = doc.getNumberOfPages();
  for (let page = 2; page <= pages; page += 1) {
    doc.setPage(page);

    doc.setDrawColor(...STROKE);
    doc.setLineWidth(0.6);
    doc.line(margin, 54, pageWidth - margin, 54);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(shortTitle, margin, 44);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(...accent);
    doc.text(brandName, pageWidth - margin, 44, { align: "right" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(footerLeft, margin, pageHeight - 30);
    doc.text(`Pagina ${page} van ${pages}`, pageWidth - margin, pageHeight - 30, { align: "right" });
  }

  const bytes = Array.from(new Uint8Array(doc.output("arraybuffer") as ArrayBuffer));
  const fallback = `adlytica-${new Date().toISOString().slice(0, 10)}.pdf`;
  return savePdf(report.filename ?? fallback, bytes);
}
