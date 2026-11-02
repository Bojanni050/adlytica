import { AdlySource, analyticsQuery, num, Row } from "./api";

/**
 * Bouwt het brondossier dat met een vraag aan Adly meegaat.
 *
 * Waarom dit bestaat: de assistent kreeg eerder een lap platte tekst mee zonder
 * herkomst. Dan kan hij cijfers noemen die nergens te controleren zijn. Hier
 * krijgt elke bron een nummer, een periode en de rijen zoals ze uit de
 * databron kwamen — het model mag daaruit citeren met [1], [2], en de UI kan
 * dat naast het antwoord laten zien.
 */
export interface AdlyDossier {
  sources: AdlySource[];
  summary: string;
}

interface BuildInput {
  accounts: Record<string, string>;
  from: string;
  to: string;
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  return String(value);
}

function toRows(rows: Row[], fields: string[]): string[][] {
  return rows.map((row) => fields.map((field) => cell(row[field])));
}

function query(input: BuildInput, connector: string, account: string, fields: string[], limit: number, groupBy?: string[]) {
  return analyticsQuery({
    connector,
    account,
    fields,
    date_from: input.from,
    date_to: input.to,
    group_by: groupBy,
    limit,
    options: connector === "google_ads" ? { include_inactive: "true" } : undefined,
  });
}

const QUERY_FIELDS = ["query", "clicks", "impressions", "position"];
const PAGE_FIELDS = ["page", "clicks", "impressions", "position"];
const CAMPAIGN_FIELDS = ["campaign_id", "campaign_name", "status", "spend", "clicks", "impressions", "conversions"];
const GA4_FIELDS = ["date", "sessions", "users", "screen_page_views"];

export async function buildAdlySources({ accounts, from, to }: BuildInput): Promise<AdlyDossier> {
  const jobs: Array<Promise<AdlySource | null>> = [
    // Search Console: waar komen de klikken vandaan.
    query({ accounts, from, to }, "searchconsole", accounts.searchconsole, QUERY_FIELDS, 300, ["query"])
      .then((rows) => {
        const sorted = [...rows].sort((a, b) => num(b.impressions) - num(a.impressions));
        const top = sorted.slice(0, 50);
        return {
          id: 1,
          label: "Search Console · top zoektermen",
          connector: "searchconsole",
          account: accounts.searchconsole,
          date_from: from,
          date_to: to,
          fields: QUERY_FIELDS,
          rows: toRows(top, QUERY_FIELDS),
          total_rows: rows.length,
        };
      })
      .catch(() => null),

    // Search Console: welke pagina's dat opleveren.
    query({ accounts, from, to }, "searchconsole", accounts.searchconsole, PAGE_FIELDS, 300, ["page"])
      .then((rows) => {
        const sorted = [...rows].sort((a, b) => num(b.impressions) - num(a.impressions));
        const top = sorted.slice(0, 25);
        return {
          id: 2,
          label: "Search Console · top pagina's",
          connector: "searchconsole",
          account: accounts.searchconsole,
          date_from: from,
          date_to: to,
          fields: PAGE_FIELDS,
          rows: toRows(top, PAGE_FIELDS),
          total_rows: rows.length,
        };
      })
      .catch(() => null),

    // Google Ads: inclusief campaign_id, zodat een pauze-actie te controleren is.
    query({ accounts, from, to }, "google_ads", accounts.google_ads, CAMPAIGN_FIELDS, 100, ["campaign_id"])
      .then((rows) => {
        const sorted = [...rows].sort((a, b) => num(b.spend) - num(a.spend));
        const top = sorted.slice(0, 50);
        return {
          id: 3,
          label: "Google Ads · campagnes",
          connector: "google_ads",
          account: accounts.google_ads,
          date_from: from,
          date_to: to,
          fields: CAMPAIGN_FIELDS,
          rows: toRows(top, CAMPAIGN_FIELDS),
          total_rows: rows.length,
        };
      })
      .catch(() => null),

    // GA4: dagcijfers, genoeg voor "loopt het verkeer op of af".
    query({ accounts, from, to }, "googleanalytics4", accounts.googleanalytics4, GA4_FIELDS, 180, ["date"])
      .then((rows) => {
        const sorted = [...rows].sort((a, b) => String(a.date ?? "").localeCompare(String(b.date ?? "")));
        return {
          id: 4,
          label: "GA4 · dagcijfers",
          connector: "googleanalytics4",
          account: accounts.googleanalytics4,
          date_from: from,
          date_to: to,
          fields: GA4_FIELDS,
          rows: toRows(sorted.slice(-90), GA4_FIELDS),
          total_rows: rows.length,
        };
      })
      .catch(() => null),
  ];

  const settled = await Promise.all(jobs);
  const sources = settled.filter((source): source is AdlySource => source !== null);
  // Nummer pas na het filteren, zodat [1] altijd de eerste bron in het dossier is.
  const numbered = sources.map((source, index) => ({ ...source, id: index + 1 }));

  const counts = numbered.map((source) => {
    const noun = source.label.split("·").pop()?.trim() || source.label;
    return `${source.rows.length} ${noun}`;
  });
  const summary = numbered.length === 0
    ? "geen databron bereikbaar — antwoord zonder cijfers"
    : `${numbered.length} bron${numbered.length === 1 ? "" : "nen"} · ${counts.join(" · ")} · ${from} t/m ${to}`;

  return { sources: numbered, summary };
}
