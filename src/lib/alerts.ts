import { AlertSettings, Row, fmt, num } from "./api";

export type AlertSeverity = "hoog" | "middel" | "laag";

export interface DashboardAlert {
  id: string;
  severity: AlertSeverity;
  title: string;
  /** De cijfers waarop de alert is gebaseerd. */
  detail: string;
  /** Waarom dit aandacht verdient. */
  impact: string;
  /** Wat de gebruiker kan doen. */
  action: string;
  /** View-id waar de knop naartoe gaat. */
  view?: string;
  viewLabel?: string;
}

export interface AlertInput {
  /** Klikken per dag van de gekozen periode. */
  gsc: Row[];
  /** Klikken per dag van de even lange periode daarvoor. */
  gscPrevious: Row[];
  /** Zoektermen van de gekozen periode. */
  queries: Row[];
  /** Zoektermen van de periode daarvoor. */
  queriesPrevious: Row[];
  /** Pagina's van de gekozen periode. */
  pages: Row[];
  days: number;
  /** Drempels uit Instellingen; de defaults staan in `DEFAULT_ALERT_SETTINGS`. */
  thresholds: AlertSettings;
}

const SEVERITY_ORDER: Record<AlertSeverity, number> = { hoog: 0, middel: 1, laag: 2 };

function sum(rows: Row[], metric: string): number {
  return rows.reduce((total, row) => total + num(row[metric]), 0);
}

function shortPath(value: unknown): string {
  const raw = String(value ?? "");
  try {
    const url = new URL(raw);
    const path = url.pathname.replace(/\/+$/, "");
    return path === "" ? "/" : path;
  } catch {
    return raw;
  }
}

/** Klikken sterk gedaald: totaal van deze periode tegenover de vorige. */
function clicksAlert(input: AlertInput): DashboardAlert | null {
  const current = sum(input.gsc, "clicks");
  const previous = sum(input.gscPrevious, "clicks");
  const thresholds = input.thresholds;
  if (previous < thresholds.min_clicks_previous) return null;

  const drop = (previous - current) / previous;
  const warn = thresholds.clicks_drop_warn_pct / 100;
  const high = thresholds.clicks_drop_high_pct / 100;
  if (drop < warn) return null;

  const percent = Math.round(drop * 100);
  const severity: AlertSeverity = drop >= high ? "hoog" : "middel";
  return {
    id: "clicks-drop",
    severity,
    title: `Organische klikken ${percent}% gedaald`,
    detail: `${fmt(current, 0)} klikken in de laatste ${input.days} dagen, tegenover ${fmt(previous, 0)} in de ${input.days} dagen daarvoor.`,
    impact: "Minder organische instroom raakt direct sessies, aanvragen en omzet.",
    action: "Bekijk in Zoekanalyse welke pagina's en zoektermen het meest zijn gezakt.",
    view: "insights",
    viewLabel: "Open Zoekanalyse",
  };
}

/** Veel vertoningen maar een lage CTR: titel of meta description sluit niet aan. */
function ctrAlert(input: AlertInput): DashboardAlert | null {
  const rows = input.pages
    .map((row) => {
      const impressions = num(row.impressions);
      const clicks = num(row.clicks);
      return {
        page: shortPath(row.page),
        impressions,
        clicks,
        ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
      };
    })
    .filter((row) => row.page !== "" && row.impressions >= input.thresholds.min_page_impressions && row.ctr < input.thresholds.max_page_ctr_pct)
    .sort((a, b) => b.impressions - a.impressions);

  if (rows.length === 0) return null;

  const worst = rows[0];
  const totalImpressions = rows.reduce((total, row) => total + row.impressions, 0);
  const extra = rows.length > 1 ? ` Nog ${rows.length - 1} pagina${rows.length === 2 ? "" : "'s"} zit in dezelfde situatie.` : "";
  return {
    id: "low-ctr",
    severity: "middel",
    title: `${rows.length} pagina${rows.length === 1 ? "" : "'s"} met veel vertoningen en lage CTR`,
    detail: `${worst.page} kreeg ${fmt(worst.impressions, 0)} vertoningen en ${fmt(worst.ctr, 2)}% CTR. Samen goed voor ${fmt(totalImpressions, 0)} vertoningen.${extra}`,
    impact: "De pagina wordt wel gezien, maar de zoekresultaten spreken te weinig aan.",
    action: "Verbeter de titel en meta description van deze pagina's en controleer of het onderwerp aansluit.",
    view: "seo",
    viewLabel: "Open SEO Analyse",
  };
}

/** Zoekwoordpositie flink gezakt ten opzichte van de vorige periode. */
function positionAlert(input: AlertInput): DashboardAlert | null {
  interface Point {
    impressions: number;
    weighted: number;
    position: number;
  }

  function aggregate(rows: Row[]): Map<string, Point> {
    const map = new Map<string, Point>();
    for (const row of rows) {
      const name = String(row.query ?? "").trim().toLowerCase();
      if (name === "") continue;
      const impressions = num(row.impressions);
      const existing = map.get(name) ?? { impressions: 0, weighted: 0, position: 0 };
      existing.impressions += impressions;
      existing.weighted += num(row.position) * impressions;
      map.set(name, existing);
    }
    for (const point of map.values()) {
      point.position = point.impressions > 0 ? point.weighted / point.impressions : 0;
    }
    return map;
  }

  const current = aggregate(input.queries);
  const previous = aggregate(input.queriesPrevious);
  const thresholds = input.thresholds;
  const dropped: { query: string; from: number; to: number; delta: number; impressions: number }[] = [];

  for (const [query, point] of current) {
    const before = previous.get(query);
    if (!before) continue;
    if (before.impressions < thresholds.min_query_impressions) continue;
    if (point.impressions < thresholds.min_query_impressions) continue;
    if (before.position <= 0 || point.position <= 0) continue;
    const delta = point.position - before.position;
    if (delta < thresholds.position_drop_warn) continue;
    dropped.push({ query, from: before.position, to: point.position, delta, impressions: point.impressions });
  }

  if (dropped.length === 0) return null;

  dropped.sort((a, b) => b.delta - a.delta || b.impressions - a.impressions);
  const worst = dropped[0];
  const severity: AlertSeverity = worst.delta >= thresholds.position_drop_high ? "hoog" : "middel";
  return {
    id: "position-drop",
    severity,
    title: `${dropped.length} zoekterm${dropped.length === 1 ? "" : "en"} zakte in positie`,
    detail: `"${worst.query}" ging van ${fmt(worst.from, 1)} naar ${fmt(worst.to, 1)} (${fmt(worst.impressions, 0)} vertoningen).`,
    impact: "Een lagere positie kost vertoningen en klikken, ook als de pagina zelf niet veranderde.",
    action: "Controleer of de pagina nog goed aansluit bij de zoekterm en bekijk de CTR in SEO Analyse.",
    view: "seo",
    viewLabel: "Open SEO Analyse",
  };
}

/**
 * Bouwt de alerts op basis van al opgehaalde data. Geen extra queries hier:
 * ontbreekt de vorige periode (connectorfout), dan vervalt de bijbehorende alert.
 */
export function buildDashboardAlerts(input: AlertInput): DashboardAlert[] {
  try {
    return [clicksAlert(input), ctrAlert(input), positionAlert(input)]
      .filter((alert): alert is DashboardAlert => alert !== null)
      .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  } catch {
    // Een rekenfout in een alert mag het dashboard nooit leegmaken.
    return [];
  }
}
