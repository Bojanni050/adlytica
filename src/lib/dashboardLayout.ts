import { getDashboardLayout, setDashboardLayout } from "./api";

export interface DashboardLayout {
  order: string[];
  hidden: string[];
}

/** Oude, lokale opslag; alleen nog als terugval en om eenmalig te migreren. */
export const DASHBOARD_LAYOUT_KEY = "adlytica.dashboard.layout.v1";

export function defaultLayout(ids: string[]): DashboardLayout {
  return { order: [...ids], hidden: [] };
}

/** Maakt van willekeurige opgeslagen data een geldige layout voor deze widgetlijst. */
export function normalizeLayout(raw: unknown, ids: string[]): DashboardLayout {
  const parsed = (raw ?? {}) as Partial<DashboardLayout>;
  const known = new Set(ids);
  const order = Array.isArray(parsed.order)
    ? parsed.order.filter((id): id is string => typeof id === "string" && known.has(id))
    : [];
  // Bewaar de volgorde van bestaande widgets en voeg nieuwe widgets achteraan toe.
  for (const id of ids) if (!order.includes(id)) order.push(id);
  const hidden = Array.isArray(parsed.hidden)
    ? parsed.hidden.filter((id): id is string => typeof id === "string" && known.has(id))
    : [];
  return { order, hidden: Array.from(new Set(hidden)) };
}

function readLocalLayout(): unknown {
  try {
    const raw = localStorage.getItem(DASHBOARD_LAYOUT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeLocalLayout(layout: DashboardLayout): void {
  try {
    localStorage.setItem(DASHBOARD_LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // localStorage kan geblokkeerd zijn; de configuratie is dan de enige opslag.
  }
}

function clearLocalLayout(): void {
  try {
    localStorage.removeItem(DASHBOARD_LAYOUT_KEY);
  } catch {
    // niets aan de hand: de state wordt alsnog teruggezet
  }
}

/** Leest de layout uit het configuratiebestand; null als dat niet kan (bijv. buiten Tauri). */
async function readConfigLayout(): Promise<unknown | undefined> {
  try {
    const layout = await getDashboardLayout();
    return layout === undefined ? null : layout;
  } catch {
    return undefined;
  }
}

/** Schrijft de layout naar het configuratiebestand; false als dat niet lukt. */
async function writeConfigLayout(layout: DashboardLayout | null): Promise<boolean> {
  try {
    await setDashboardLayout(layout);
    return true;
  } catch {
    return false;
  }
}

/**
 * Laadt de dashboardlay-out: eerst uit het configuratiebestand (config.json), met een
 * eenmalige migratie van de oude localStorage-versie, en anders de standaardindeling.
 */
export async function loadDashboardLayout(ids: string[]): Promise<DashboardLayout> {
  const fromConfig = await readConfigLayout();
  if (fromConfig !== undefined && fromConfig) return normalizeLayout(fromConfig, ids);
  const legacy = readLocalLayout();
  if (fromConfig === undefined) return normalizeLayout(legacy ?? null, ids);
  if (legacy) {
    // Migratie: de oude lokale keuze verhuist naar het configuratiebestand.
    const migrated = normalizeLayout(legacy, ids);
    if (await writeConfigLayout(migrated)) clearLocalLayout();
    return migrated;
  }
  return defaultLayout(ids);
}

/** Bewaart de dashboardlay-out in het configuratiebestand, met localStorage als terugval. */
export async function saveDashboardLayout(layout: DashboardLayout): Promise<void> {
  if (!(await writeConfigLayout(layout))) writeLocalLayout(layout);
}

export async function resetDashboardLayout(ids: string[]): Promise<DashboardLayout> {
  await writeConfigLayout(null);
  clearLocalLayout();
  return defaultLayout(ids);
}


/** Verplaatst een widget naar de plek van de widget waarop is gedropt. */
export function reorderWidgets(order: string[], dragId: string, targetId: string): string[] {
  const from = order.indexOf(dragId);
  const to = order.indexOf(targetId);
  if (from < 0 || to < 0 || from === to) return order;
  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, dragId);
  return next;
}

/** Verplaatst een zichtbare widget één plek, zonder verborgen widgets te verplaatsen. */
export function moveVisibleWidget(
  order: string[],
  hidden: string[],
  id: string,
  direction: -1 | 1
): string[] {
  const visible = order.filter((item) => !hidden.includes(item));
  const from = visible.indexOf(id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= visible.length) return order;
  [visible[from], visible[to]] = [visible[to], visible[from]];
  let cursor = 0;
  return order.map((item) => (hidden.includes(item) ? item : visible[cursor++]));
}
