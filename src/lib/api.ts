import { invoke } from "@tauri-apps/api/core";

export interface QueryParams {
  connector: string;
  account: string;
  fields: string[];
  date_from?: string;
  date_to?: string;
  group_by?: string[];
  options?: Record<string, unknown>;
  limit?: number;
}

export type Row = Record<string, unknown>;

/** Leest bij de self-hosted analytics-service (GA4, Search Console, Google Ads).
 *  Resultaten worden vijf minuten hergebruikt; `refresh: true` slaat de cache over. */
export async function analyticsQuery(
  params: QueryParams,
  options: { refresh?: boolean } = {}
): Promise<Row[]> {
  const result = await invoke<{ rows: Row[] }>("analytics_query", {
    params,
    refresh: options.refresh ?? false,
  });
  return result.rows ?? [];
}

export interface CacheStats {
  entries: number;
  hits: number;
  misses: number;
  ttl_seconds: number;
}

/** Leegt de querycache; geeft het aantal weggegooide resultaten terug. */
export async function clearAnalyticsCache(): Promise<number> {
  return invoke<number>("analytics_cache_clear");
}

export async function getAnalyticsCacheStats(): Promise<CacheStats> {
  return invoke<CacheStats>("analytics_cache_stats");
}

export async function analyticsAction(
  connector: string,
  account: string,
  action: string,
  params?: Record<string, unknown>
): Promise<unknown> {
  return invoke("analytics_action", { connector, account, action, params: params ?? {} });
}

/** Eén uitgevoerde (of mislukte) wijziging in Google Ads. */
export interface ChangeLogEntry {
  id: string;
  at: string;
  connector: string;
  account: string;
  action: string;
  title: string;
  params: Record<string, unknown>;
  status: "uitgevoerd" | "teruggedraaid" | "mislukt";
  message: string | null;
  undone_by: string | null;
  undo_of: string | null;
}

export interface AdsActionResult {
  entry: ChangeLogEntry;
  log: ChangeLogEntry[];
}

export async function getChangeLog(): Promise<ChangeLogEntry[]> {
  return invoke<ChangeLogEntry[]>("get_change_log");
}

/**
 * Voert een Ads-wijziging uit via de beveiligde route: de backend controleert
 * de actie, de daglimiet en (bij undo) of de omkering klopt, en logt alles.
 */
export async function adsApplyChange(
  action: string,
  params: Record<string, unknown>,
  title: string,
  undoOf?: string
): Promise<AdsActionResult> {
  return invoke<AdsActionResult>("ads_apply_change", {
    action,
    params,
    title,
    undoOf: undoOf ?? null,
  });
}

/** Bewaart de databron (service-URL + token) en de account-ID's. */
export async function setAnalyticsConfig(
  baseUrl: string,
  token: string,
  accounts: Record<string, string>
): Promise<void> {
  return invoke("set_analytics_config", { baseUrl, token, accounts });
}

/** Test de databron: GET /health op de ingestelde service-URL. */
export async function testAnalytics(): Promise<string> {
  return invoke<string>("test_analytics");
}

export interface LoginStatus {
  phase: "idle" | "pending" | "ok" | "error";
  message: string;
  /** De authorize-URL; blijft staan zolang de login loopt, zodat je hem zelf kunt openen. */
  url: string;
}

/**
 * Start de login op de databron: de app registreert zich bij de service (DCR),
 * krijgt een authorize-URL terug en zet een listener op een lokale poort klaar.
 * De URL is een gewone returnwaarde, dus altijd beschikbaar in de UI.
 */
export async function analyticsLoginStart(baseUrl: string): Promise<string> {
  return invoke<string>("analytics_login_start", { baseUrl });
}

/** Voortgang van de laatste loginpoging ("idle" | "pending" | "ok" | "error"). */
export async function analyticsLoginStatus(): Promise<LoginStatus> {
  return invoke<LoginStatus>("analytics_login_status");
}

/** Wist de inloggegevens van de databron. */
export async function analyticsLogout(): Promise<void> {
  return invoke("analytics_logout");
}

export async function getAccounts(): Promise<Record<string, string>> {
  return invoke("get_accounts");
}

export async function setPythonPath(python: string): Promise<void> {
  return invoke("set_python_path", { python });
}

export async function getDashboardLayout(): Promise<unknown> {
  return invoke("get_dashboard_layout");
}

export async function setDashboardLayout(layout: unknown): Promise<void> {
  return invoke("set_dashboard_layout", { layout: layout ?? null });
}

export interface RankPoint {
  date: string;
  position: number;
}

export interface RankingStore {
  tracked: string[];
  history: Record<string, RankPoint[]>;
}

export async function getRankings(): Promise<RankingStore> {
  return invoke("get_rankings");
}

export async function trackKeyword(keyword: string): Promise<RankingStore> {
  return invoke("track_keyword", { keyword });
}

export async function untrackKeyword(keyword: string): Promise<RankingStore> {
  return invoke("untrack_keyword", { keyword });
}

export async function recordRankPoints(
  points: { keyword: string; date: string; position: number }[],
): Promise<RankingStore> {
  return invoke("record_rank_points", { points });
}

export interface SettingsStatus {
  analytics_base_url: string | null;
  analytics_token_set: boolean;
  /** True als er een refresh-token is: de app kan het token dan zelf vernieuwen. */
  analytics_can_refresh: boolean;
  mistral_key_set: boolean;
  mistral_model: string;
  accounts: Record<string, string>;
  python_path: string;
  config_path: string | null;
  /** Pad van het login-logboek, zoals de backend het daadwerkelijk gebruikt. */
  login_log_path: string | null;
  wp_url: string | null;
  wp_user: string | null;
  wp_password_set: boolean;
  pagespeed_key_set: boolean;
  dataforseo_set: boolean;
  /** Drempels en schakelaars voor de dashboard-alerts. */
  alerts: AlertSettings;
}

/**
 * Spiegel van `AlertSettings` in `src-tauri/src/config.rs`. De backend schoont
 * de waarden op (percentages 0–100, ernst nooit strenger dan waarschuwing) en
 * geeft die opgeschoonde versie terug.
 */
export interface AlertSettings {
  enabled: boolean;
  badge: boolean;
  notify: boolean;
  clicks_drop_warn_pct: number;
  clicks_drop_high_pct: number;
  min_clicks_previous: number;
  min_page_impressions: number;
  max_page_ctr_pct: number;
  min_query_impressions: number;
  position_drop_warn: number;
  position_drop_high: number;
}

/** Zelfde waarden als `impl Default for AlertSettings` in Rust. */
export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  enabled: true,
  badge: true,
  notify: false,
  clicks_drop_warn_pct: 15,
  clicks_drop_high_pct: 30,
  min_clicks_previous: 100,
  min_page_impressions: 1000,
  max_page_ctr_pct: 1,
  min_query_impressions: 100,
  position_drop_warn: 2,
  position_drop_high: 5,
};

export async function setAlertSettings(settings: AlertSettings): Promise<AlertSettings> {
  return invoke<AlertSettings>("set_alert_settings", { settings });
}

export type ActionStatus = "nieuw" | "gezien" | "uitgevoerd" | "genegeerd";

export const ACTION_STATUSES: ActionStatus[] = ["nieuw", "gezien", "uitgevoerd", "genegeerd"];

/** Eén taak uit het actiecentrum; de backend bewaart ze in config.json. */
export interface ActionItem {
  id: string;
  title: string;
  detail: string;
  status: ActionStatus;
  source: "alert" | "handmatig";
  alert_key: string | null;
  view: string | null;
  created_at: string;
  updated_at: string;
}

export async function getActions(): Promise<ActionItem[]> {
  return invoke<ActionItem[]>("get_actions");
}

export async function setActions(actions: ActionItem[]): Promise<ActionItem[]> {
  return invoke<ActionItem[]>("set_actions", { actions });
}

/** Een bevroren rapport: de cijfers zoals ze bij het bewaren waren. */
export interface ReportSnapshot {
  id: string;
  title: string;
  created_at: string;
  date_from: string;
  date_to: string;
  days: number;
  kpis: { label: string; value: string }[];
  sections: { title: string; head: string[]; rows: string[][]; note: string | null }[];
}

export async function getReportSnapshots(): Promise<ReportSnapshot[]> {
  return invoke<ReportSnapshot[]>("get_report_snapshots");
}

/** Bewaart (of vervangt) een snapshot; geeft de opgeschoonde lijst terug. */
export async function saveReportSnapshot(report: ReportSnapshot): Promise<ReportSnapshot[]> {
  return invoke<ReportSnapshot[]>("save_report_snapshot", { report });
}

export async function deleteReportSnapshot(id: string): Promise<ReportSnapshot[]> {
  return invoke<ReportSnapshot[]>("delete_report_snapshot", { id });
}

export async function getSettingsStatus(): Promise<SettingsStatus> {
  return invoke("get_settings_status");
}

export async function setWordpressConfig(
  url: string,
  user: string,
  password: string,
): Promise<void> {
  return invoke("set_wordpress_config", { url, user, password });
}

/** Controleert de WordPress-verbinding en geeft de sitenaam terug. */
export async function testWordpress(): Promise<string> {
  return invoke("test_wordpress");
}

export interface WpSeo {
  id: number;
  post_type: string;
  permalink: string;
  title: string;
  description: string;
  focus_keyword: string;
}

/** Zoekt de pagina bij een URL en leest de Rank Math-velden. */
export async function getWpSeo(url: string): Promise<WpSeo> {
  return invoke("get_wp_seo", { url });
}

/** Schrijft titel en description naar Rank Math. */
export async function setWpSeo(
  kind: string,
  id: number,
  title: string,
  description: string,
): Promise<WpSeo> {
  return invoke("set_wp_seo", { kind, id, title, description });
}

export interface BrandConfig {
  name: string;
  accent: string;
  footer: string;
  /** Logo als data-URL (png/jpeg/webp/svg), of null voor het standaardmerk. */
  logo: string | null;
}

export async function getBrand(): Promise<BrandConfig | null> {
  return invoke("get_brand");
}

export async function setBrand(brand: BrandConfig | null): Promise<void> {
  return invoke("set_brand", { brand });
}

export async function setMistralConfig(apiKey: string, model: string): Promise<void> {
  return invoke("set_mistral_config", { apiKey, model });
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Eén bron in het brondossier dat met de vraag meegaat. De rijen zijn al
 * tekst: het model krijgt geen getallen om zelf mee te rekenen, alleen wat er
 * letterlijk in de databron stond.
 */
export interface AdlySource {
  id: number;
  label: string;
  connector: string;
  account: string;
  date_from: string;
  date_to: string;
  fields: string[];
  rows: string[][];
  total_rows: number;
}

export async function adlyChat(
  messages: ChatMessage[],
  context?: string,
  sources?: AdlySource[],
): Promise<string> {
  return invoke("adly_chat", {
    messages,
    context: context ?? null,
    sources: sources ?? null,
  });
}

export interface TrendsRequest {
  method: string;
  keywords: string[];
  timeframe?: string;
  geo?: string;
}

export async function trendsQuery(req: TrendsRequest): Promise<unknown> {
  return invoke("trends_query", { req });
}

export function num(v: unknown): number {
  const n = typeof v === "string" ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
}

export function fmt(n: number, digits = 2): string {
  return n.toLocaleString("nl-NL", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function pct(n: number): string {
  return `${fmt(n * 100, 1)}%`;
}

export function dateNDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export async function getNotifications(): Promise<boolean> {
  return invoke<boolean>("get_notifications");
}

export async function setNotifications(enabled: boolean): Promise<void> {
  await invoke("set_notifications", { enabled });
}

/** Toont een Windows-melding; de Rust-kant negeert hem als meldingen uit staan. */
export async function notifyNow(title: string, body: string): Promise<void> {
  await invoke("notify_now", { title, body });
}

export async function testNotification(): Promise<void> {
  await invoke("test_notification");
}

/** Schrijft een door de frontend opgebouwde PDF naar de map Downloads en geeft het pad terug. */
export async function savePdf(filename: string, bytes: number[]): Promise<string> {
  return invoke<string>("save_pdf", { filename, bytes });
}

/** Opent een opgeslagen bestand (bijv. een PDF) met de standaardapp van het besturingssysteem. */
export async function openPath(path: string): Promise<void> {
  await invoke<void>("open_path", { path });
}

/** Opent de map van het bestand in de Verkenner met het bestand geselecteerd. */
export async function revealPath(path: string): Promise<void> {
  await invoke<void>("reveal_path", { path });
}

export interface AuditIssue {
  code: string;
  severity: "error" | "warning";
  message: string;
}

export interface AuditPage {
  url: string;
  status: number;
  final_url: string;
  redirect: boolean;
  title: string;
  title_len: number;
  meta_len: number;
  h1: string;
  h1_count: number;
  canonical: string;
  noindex: boolean;
  words: number;
  images: number;
  images_no_alt: number;
  internal_links: number;
  external_links: number;
  schema: string[];
  og: boolean;
  hreflang: number;
  lang_missing: boolean;
  inbound: number;
  score: number;
  similar: string[];
  ms: number;
  errors: number;
  warnings: number;
  issues: AuditIssue[];
}

export interface LinkFinding {
  source: string;
  target: string;
  kind: "internal" | "external";
  status: number;
  problem: "broken" | "redirect";
}

export interface AuditTask {
  code: string;
  label: string;
  severity: "error" | "warning";
  impact: "high" | "medium" | "low";
  count: number;
  pages: string[];
}

export interface PreviousRun {
  at: string;
  score: number;
  errors: number;
  warnings: number;
  crawled: number;
}

export interface SiteCheck {
  label: string;
  ok: boolean;
  detail: string;
}

export interface AuditResult {
  base: string;
  pages: AuditPage[];
  crawled: number;
  failed: number;
  truncated: boolean;
  sitemap_urls: number;
  duration_ms: number;
  score: number;
  tasks: AuditTask[];
  links: LinkFinding[];
  orphans: string[];
  checks: SiteCheck[];
  previous: PreviousRun | null;
}

/** Crawlt de site in Rust en geeft per pagina de technische bevindingen terug. */
export async function runAudit(url: string, limit: number): Promise<AuditResult> {
  return invoke<AuditResult>("run_audit", { url, limit });
}


export interface PageSpeedScores {
  performance: number;
  accessibility: number;
  best_practices: number;
  seo: number;
}

export interface PageSpeedMetric {
  key: string;
  label: string;
  value: string;
  score: number;
}

export interface PageSpeedOpportunity {
  title: string;
  description: string;
  savings_ms: number;
}

export interface PageSpeedResult {
  url: string;
  strategy: "mobile" | "desktop";
  scores: PageSpeedScores;
  metrics: PageSpeedMetric[];
  opportunities: PageSpeedOpportunity[];
  fetched_at: string;
}

export async function setPagespeedKey(key: string): Promise<void> {
  await invoke("set_pagespeed_key", { key });
}

/** Meet een pagina met PageSpeed Insights; de Rust-kant gebruikt de bewaarde key. */
export async function runPageSpeed(url: string, strategy: "mobile" | "desktop"): Promise<PageSpeedResult> {
  return invoke<PageSpeedResult>("pagespeed", { url, strategy });
}

export interface GapRow {
  keyword: string;
  volume: number;
  ranks: (number | null)[];
}

export interface GapResult {
  domains: string[];
  rows: GapRow[];
  cost: number;
  found: number[];
  gap_volume: number;
}

export async function setDataForSeo(login: string, password: string): Promise<void> {
  await invoke("set_dataforseo", { login, password });
}

/** Betaalde DataForSEO-call: één Labs-taak per domein. */
export async function dataforseoGap(domains: string[], limit = 500): Promise<GapResult> {
  return invoke<GapResult>("dataforseo_gap", { domains, limit });
}
