import { ActionItem, ActionStatus, getActions, setActions } from "./api";
import type { DashboardAlert } from "./alerts";

/** Wordt verstuurd na elke wijziging, zodat de zijbalk en views bijblijven. */
export const ACTIONS_EVENT = "adlytica:actions-changed";

const CLOSED_STATUSES: ActionStatus[] = ["uitgevoerd", "genegeerd"];
const STATUS_ORDER: Record<ActionStatus, number> = { nieuw: 0, gezien: 1, uitgevoerd: 2, genegeerd: 3 };

function nowIso(): string {
  return new Date().toISOString();
}

export function makeActionId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
  return `taak-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Signalen zijn alleen "dezelfde taak" als titel en bron-regel gelijk zijn. */
export function actionKey(alert: DashboardAlert): string {
  return `${alert.id}|${alert.title}`;
}

export function isOpenAction(action: ActionItem): boolean {
  return !CLOSED_STATUSES.includes(action.status);
}

export function countOpenActions(list: ActionItem[]): number {
  return list.filter(isOpenAction).length;
}

export function openActions(list: ActionItem[]): ActionItem[] {
  return list.filter(isOpenAction);
}

/** Open taken eerst, dan op status, dan de nieuwste bovenaan. */
export function sortActions(list: ActionItem[]): ActionItem[] {
  return [...list].sort((a, b) => {
    const openDiff = Number(!isOpenAction(a)) - Number(!isOpenAction(b));
    if (openDiff !== 0) return openDiff;
    const statusDiff = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (statusDiff !== 0) return statusDiff;
    return (b.created_at ?? "").localeCompare(a.created_at ?? "");
  });
}

function notifyChanged() {
  try {
    window.dispatchEvent(new Event(ACTIONS_EVENT));
  } catch {
    // Zonder venster (bijvoorbeeld een test) is er niets te melden.
  }
}

export async function loadActions(): Promise<ActionItem[]> {
  return sortActions(await getActions());
}

export async function saveActions(list: ActionItem[]): Promise<ActionItem[]> {
  const stored = sortActions(await setActions(list));
  notifyChanged();
  return stored;
}

export function makeActionFromAlert(alert: DashboardAlert, stamp = nowIso()): ActionItem {
  return {
    id: makeActionId(),
    title: alert.title,
    detail: alert.detail,
    status: "nieuw",
    source: "alert",
    alert_key: actionKey(alert),
    view: alert.view ?? null,
    created_at: stamp,
    updated_at: stamp,
  };
}

export function makeManualAction(
  title: string,
  detail: string,
  view: string | null = null,
  stamp = nowIso()
): ActionItem {
  return {
    id: makeActionId(),
    title: title.trim(),
    detail: detail.trim(),
    status: "nieuw",
    source: "handmatig",
    alert_key: null,
    view: view && view !== "" ? view : null,
    created_at: stamp,
    updated_at: stamp,
  };
}

/**
 * Zet een signaal om in een taak. Bestaat er al een open taak voor hetzelfde
 * signaal, dan gebeurt er niets en blijft de lijst zoals hij is.
 */
export async function createActionFromAlert(
  alert: DashboardAlert
): Promise<{ added: boolean; actions: ActionItem[] }> {
  const list = await loadActions();
  const key = actionKey(alert);
  if (list.some((action) => action.alert_key === key && isOpenAction(action))) {
    return { added: false, actions: list };
  }
  const stored = await saveActions([...list, makeActionFromAlert(alert)]);
  return { added: true, actions: stored };
}

export async function addManualAction(
  title: string,
  detail: string,
  view: string | null
): Promise<ActionItem[]> {
  if (title.trim() === "") throw new Error("Geef de taak een titel.");
  const list = await loadActions();
  return saveActions([...list, makeManualAction(title, detail, view)]);
}

export async function setActionStatus(
  list: ActionItem[],
  id: string,
  status: ActionStatus
): Promise<ActionItem[]> {
  const stamp = nowIso();
  return saveActions(
    list.map((action) => (action.id === id ? { ...action, status, updated_at: stamp } : action))
  );
}

export async function removeAction(list: ActionItem[], id: string): Promise<ActionItem[]> {
  return saveActions(list.filter((action) => action.id !== id));
}
