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

export interface SettingsStatus {
  windsor_key_set: boolean;
  mistral_key_set: boolean;
  mistral_model: string;
  accounts: Record<string, string>;
  python_path: string;
  config_path: string | null;
}

export async function getSettingsStatus(): Promise<SettingsStatus> {
  return invoke("get_settings_status");
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
