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

export async function windsorQuery(params: QueryParams): Promise<Row[]> {
  const result = await invoke<{ rows: Row[] }>("windsor_query", { params });
  return result.rows ?? [];
}

export async function windsorAction(
  connector: string,
  account: string,
  action: string,
  params?: Record<string, unknown>
): Promise<unknown> {
  return invoke("windsor_action", { connector, account, action, params: params ?? {} });
}

export async function setWindsorKey(
  key: string,
  accounts: Record<string, string>
): Promise<void> {
  return invoke("set_windsor_key", { key, accounts });
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
  windsor_key_set: boolean;
  mistral_key_set: boolean;
  mistral_model: string;
  accounts: Record<string, string>;
  python_path: string;
  config_path: string | null;
  wp_url: string | null;
  wp_user: string | null;
  wp_password_set: boolean;
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

export async function adlyChat(messages: ChatMessage[], context?: string): Promise<string> {
  return invoke("adly_chat", { messages, context: context ?? null });
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
  ms: number;
  errors: number;
  warnings: number;
  issues: AuditIssue[];
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
  checks: SiteCheck[];
}

/** Crawlt de site in Rust en geeft per pagina de technische bevindingen terug. */
export async function runAudit(url: string, limit: number): Promise<AuditResult> {
  return invoke<AuditResult>("run_audit", { url, limit });
}
