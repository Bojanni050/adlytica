/**
 * Grafiekthema. Eén regel: de kleur zegt uit welke bron het cijfer komt.
 * Organisch = blauw, betaald = amber, GA4 = violet. Zo lees je in elke
 * grafiek meteen wie de eigenaar van de reeks is, in plaats van per widget
 * een nieuwe kleur te verzinnen.
 */
import type { CSSProperties } from "react";

export const SERIES = {
  organic: "#3d93f0",
  organicSoft: "#6fb4f7",
  paid: "#e6a53c",
  paidSoft: "#f0c164",
  ga4: "#a99cf7",
  ga4Soft: "#c4baff",
} as const;

/** Vijf onderscheiden tinten voor grafieken met losse reeksen (Google Trends).
 *  Bewust zonder mint en rood: die twee betekenen in deze app winst en verlies
 *  en mogen nooit als categorie opduiken. */
export const SERIES_RAMP = ["#3d93f0", "#e6a53c", "#a99cf7", "#4fc3d9", "#e084b8"];

export const CHART = {
  grid: "rgba(126, 164, 214, 0.10)",
  axis: "#71829a",
  tickFontSize: 10.5,
  cursorLine: "rgba(61, 147, 240, 0.42)",
  cursorFill: "rgba(61, 147, 240, 0.07)",
  tooltip: {
    background: "#111823",
    border: "1px solid #243040",
    borderRadius: 9,
    fontSize: 12,
    color: "#e8eef7",
    boxShadow: "0 12px 32px -8px rgba(0, 0, 0, 0.6)",
    padding: "8px 11px",
  } as React.CSSProperties,
  legend: { fontSize: 10.5, color: "#71829a" } as React.CSSProperties,
} as const;
