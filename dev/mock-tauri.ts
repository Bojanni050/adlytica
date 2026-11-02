/**
 * Ontwikkelhulp — NIET onderdeel van de app.
 *
 * De app praat met de Rust-kant via `invoke()`. In een gewone browser bestaat
 * die brug niet, dus elke view blijft leeg. Deze mock vervangt
 * `@tauri-apps/api/core` (alleen via `vite.mock.config.ts`) en verzint
 * deterministische voorbeeldcijfers, zodat het ontwerp in een echte browser
 * te bekijken en te fotograferen is zonder Google-account.
 *
 * `npm run dev:mock` start de app op deze manier. `npm run dev` (en de
 * Tauri-build) gebruikt gewoon de echte brug.
 */

/* ── Deterministische ruis: dezelfde cijfers bij elke herlaadbeurt ────────── */

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function makeRandom(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/* ── Voorraad namen ──────────────────────────────────────────────────────── */

const QUERIES = [
  "zwarte trouwjurk", "trouwjurk passen amsterdam", "tweedehands trouwjurk",
  "trouwjurk vermaken kosten", "avondjurk lange mouwen", "galajurk groen",
  "cocktailjurk klein", "trouwjurk met sleep", "jurk voor bruiloft gast",
  "trouwjurk outlet utrecht", "maten trouwjurk", "trouwjurk huren of kopen",
  "avondjurk met split", "trouwjurk laten innemen", "galajurk met glitter",
  "zwarte galajurk", "trouwjurk voor kleine vrouw", "jurk voor gala avond",
  "trouwjurk stomerij", "avondjurk met lange mouwen groen",
];

const PAGES = [
  "https://white-vision.nl/", "https://white-vision.nl/trouwjurken/",
  "https://white-vision.nl/avondjurken/", "https://white-vision.nl/galajurken/",
  "https://white-vision.nl/trouwjurk-vermaken/", "https://white-vision.nl/outlet/",
  "https://white-vision.nl/blog/trouwjurk-passen/", "https://white-vision.nl/maten/",
  "https://white-vision.nl/contact/", "https://white-vision.nl/blog/avondjurk-combineren/",
  "https://white-vision.nl/trouwjurken/zwart/", "https://white-vision.nl/afspraak/",
];

const CAMPAIGNS = [
  "Search — Trouwjurken (merk)", "Search — Trouwjurken (generiek)",
  "Search — Avondjurken", "Performance Max — Collectie",
  "Shopping — Outlet", "Display — Retargeting",
];

const AD_GROUPS = [
  "trouwjurk", "zwarte jurk", "galajurk", "avondjurk", "outlet", "merk",
  "vermaken", "huren",
];

const DEVICES = ["mobiel", "desktop", "tablet"];
const COUNTRIES = ["Nederland", "België", "Duitsland"];
const CHANNELS = ["google / organic", "(direct) / (none)", "nieuwsbrief / email", "instagram / social"];

function pool(field: string): string[] | null {
  switch (field) {
    case "query": case "keyword": case "search_term": case "term": return QUERIES;
    case "page": case "landing_page": case "url": return PAGES;
    case "campaign": case "campaign_name": return CAMPAIGNS;
    case "ad_group": case "ad_group_name": return AD_GROUPS;
    case "device": case "device_category": return DEVICES;
    case "country": return COUNTRIES;
    case "source": case "source_medium": case "channel": return CHANNELS;
    case "medium": return ["organic", "none", "email", "social"];
    default: return null;
  }
}

/* ── Datumhulpjes ────────────────────────────────────────────────────────── */

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): string[] {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  const out: string[] = [];
  for (let day = new Date(start); day <= end && out.length < 400; day.setUTCDate(day.getUTCDate() + 1)) {
    out.push(isoDate(day));
  }
  return out;
}

/* ── Query-synthese ──────────────────────────────────────────────────────── */

interface QueryParams {
  connector?: string;
  account?: string;
  fields?: string[];
  date_from?: string;
  date_to?: string;
  group_by?: string[];
  limit?: number;
}

const MONEY = new Set(["spend", "cost", "cpc", "cpm", "average_cpc", "revenue", "value"]);
const RATIO = new Set(["ctr", "conversion_rate", "interaction_rate"]);
const POSITION = new Set(["position", "average_position", "avg_position", "rank"]);

function numberFor(field: string, quality: number, random: () => number): number {
  if (POSITION.has(field)) return Math.round((1 + (1 - quality) * 22 + random() * 2) * 10) / 10;
  if (MONEY.has(field)) return Math.round((quality * 38 + random() * 22) * 100) / 100;
  if (RATIO.has(field)) return Math.round((0.6 + quality * 15 + random() * 2) * 100) / 100;
  if (field === "conversions") return Math.round(quality * 6 + random() * 3);
  if (field === "clicks") return Math.max(3, Math.round(quality * 620 * (0.35 + random())));
  if (field === "impressions" || field === "impr") return Math.max(60, Math.round(quality * 14000 * (0.3 + random())));
  if (field === "sessions") return Math.max(8, Math.round(quality * 900 * (0.4 + random())));
  if (field === "users") return Math.max(6, Math.round(quality * 640 * (0.4 + random())));
  if (field === "screen_page_views" || field === "views") return Math.max(10, Math.round(quality * 1600 * (0.4 + random())));
  if (field === "volume" || field === "search_volume") return Math.round(80 + quality * 4200 + random() * 300);
  if (field === "words") return Math.round(320 + quality * 1400);
  return Math.max(1, Math.round(quality * 400 * (0.3 + random())));
}

interface Entity {
  values: Record<string, unknown>;
  /** Kwaliteit van deze entiteit: hoe hoger, hoe meer klikken en hoe beter de positie. */
  quality: number;
  /** True voor de circa 20% die in de laatste week hard wegzakt. */
  falls: boolean;
}

function synthesize(params: QueryParams): Record<string, unknown>[] {
  const fields = params.fields ?? [];
  const groupBy = params.group_by ?? [];
  const random = makeRandom(hashString(JSON.stringify({
    connector: params.connector, fields, groupBy, from: params.date_from, to: params.date_to,
  })));

  const today = new Date();
  const to = params.date_to ?? isoDate(today);
  const from = params.date_from ?? isoDate(new Date(today.getTime() - 89 * 86_400_000));
  const dates = daysBetween(from, to);

  const entityFields = groupBy.filter((field) => field !== "date");
  const hasDate = groupBy.includes("date");
  const pools = entityFields
    .map((field) => ({ field, values: pool(field) }))
    .filter((entry): entry is { field: string; values: string[] } => entry.values !== null);

  // Combinaties van entiteiten. De kwaliteit hangt aan de eerste groep
  // (meestal de zoekterm of pagina), zodat een tweede pagina bij dezelfde
  // zoekterm een echt aandeel houdt — dat is wat cannibalisatie zichtbaar maakt.
  let entities: Entity[] = [{ values: {}, quality: 0.7, falls: false }];
  for (const entry of pools) {
    const cap = params.limit && params.limit < 200 ? Math.min(entry.values.length, params.limit) : entry.values.length;
    entities = entities.flatMap((current) =>
      entry.values.slice(0, cap).map((value, index) => {
        const values = { ...current.values, [entry.field]: value };
        if (index === 0 && Object.keys(current.values).length === 0) {
          const base = 0.36 + (hashString(String(value)) % 1000) / 1000 * 0.64;
          return { values, quality: base, falls: hashString(String(value)) % 5 === 0 };
        }
        return {
          values,
          quality: current.quality * (index === 0 ? 1 : 0.44),
          falls: current.falls,
        };
      })
    );
  }

  const rows: Record<string, unknown>[] = [];
  const daySlots = hasDate ? dates : [null];

  for (const day of daySlots) {
    const dayIndex = day ? dates.indexOf(day) : 0;
    const weekday = day ? new Date(`${day}T00:00:00Z`).getUTCDay() : 3;
    // Rustige zondag, drukke dinsdag: de grafieken krijgen een echt ritme.
    const weekly = weekday === 0 ? 0.62 : weekday === 6 ? 0.78 : weekday === 2 ? 1.12 : 1;
    const drift = 1 + Math.sin(dayIndex / 9) * 0.16 + dayIndex / Math.max(30, dates.length * 4);
    // De laatste week zakt een vijfde van de pagina's en zoektermen hard weg,
    // zodat de anomaliewidgets en het alertblok echt iets te melden hebben.
    const recent = hasDate && dates.length - dayIndex <= 7;

    for (const entity of entities) {
      const quality = entity.quality * (recent && entity.falls ? 0.42 : 1);

      const row: Record<string, unknown> = {};
      for (const field of fields) {
        if (field === "date") { row.date = day; continue; }
        const values = pool(field);
        if (values) {
          row[field] = field in entity.values ? entity.values[field] : values[0];
          continue;
        }
        row[field] = Math.round(numberFor(field, quality, random) * weekly * drift * 100) / 100;
      }
      for (const field of entityFields) if (!(field in row)) row[field] = entity.values[field];

      // Klikken, impressies en CTR moeten op elkaar kloppen.
      const impressions = row.impressions;
      const clicks = row.clicks;
      if (typeof impressions === "number" && typeof clicks === "number") {
        const total = Math.max(clicks, Math.round(impressions));
        row.impressions = total;
        if (fields.includes("ctr")) row.ctr = Math.round((clicks / total) * 10000) / 100;
      }
      rows.push(row);
    }
  }

  if (!hasDate) {
    const metric = (row: Record<string, unknown>) =>
      Number(row.clicks ?? row.impressions ?? row.sessions ?? row.spend ?? 0);
    rows.sort((a, b) => metric(b) - metric(a));
  }
  return rows.slice(0, params.limit ?? 2000);
}

/* ── Vaste antwoorden voor de overige commando's ─────────────────────────── */

const ACCOUNTS = { searchconsole: "https://white-vision.nl/", google_ads: "307-043-6491", googleanalytics4: "368911252" };

const SETTINGS = {
  analytics_base_url: "https://analytics.studiovanderheide.nl",
  analytics_token_set: true,
  analytics_can_refresh: true,
  mistral_key_set: true,
  mistral_model: "mistral-large-latest",
  accounts: ACCOUNTS,
  python_path: "/usr/bin/python3",
  config_path: "/home/bo/.config/adlytica/config.json",
  login_log_path: "/home/bo/.config/adlytica/login.log",
  wp_url: "https://white-vision.nl",
  wp_user: "bo",
  wp_password_set: true,
  pagespeed_key_set: true,
  dataforseo_set: true,
  alerts: {
    enabled: true, badge: true, notify: false,
    clicks_drop_warn_pct: 15, clicks_drop_high_pct: 30, min_clicks_previous: 100,
    min_page_impressions: 1000, max_page_ctr_pct: 1, min_query_impressions: 100,
    position_drop_warn: 2, position_drop_high: 5,
  },
};

const RANKINGS = {
  tracked: ["zwarte trouwjurk", "trouwjurk passen amsterdam", "tweedehands trouwjurk", "galajurk groen"],
  history: Object.fromEntries(
    ["zwarte trouwjurk", "trouwjurk passen amsterdam", "tweedehands trouwjurk", "galajurk groen"].map((keyword, index) => {
      const random = makeRandom(hashString(keyword));
      let position = 18 - index * 2;
      return [
        keyword,
        Array.from({ length: 26 }, (_, week) => {
          position = Math.max(1, Math.min(60, position + (random() - 0.55) * 3.4));
          return {
            date: isoDate(new Date(Date.now() - (25 - week) * 7 * 86_400_000)),
            position: Math.round(position * 10) / 10,
          };
        }),
      ];
    })
  ),
};

const ACTIONS = [
  {
    id: "a1", title: "Trouwjurk-vermaakpagina verliest 41% klikken",
    detail: "Clicks zakten van 214 naar 126 in week 45. Positie bleef gelijk, dus dit is geen algoritme-update.",
    status: "nieuw" as const, source: "alert" as const, alert_key: "click-drop:/trouwjurk-vermaken/",
    view: "seo", created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  },
  {
    id: "a2", title: "Budget 'Search — Avondjurken' raakt daglimiet vóór 16:00",
    detail: "Zeven van de tien dagen op tempo 118%. Verhoog het dagbudget of verlaag de bieding op 'avondjurk met split'.",
    status: "gezien" as const, source: "alert" as const, alert_key: "pace",
    view: "budget", created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  },
  {
    id: "a3", title: "Twee pagina's vangen dezelfde zoekterm",
    detail: "'trouwjurk vermaken kosten' verschijnt op /trouwjurk-vermaken/ (4,2) en /maten/ (11,8). Kies één canonical.",
    status: "uitgevoerd" as const, source: "alert" as const, alert_key: "cannibal",
    view: "insights", created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  },
];

const SNAPSHOTS = [
  {
    id: "s1", title: "White Vision — Q4 organisch", created_at: new Date(Date.now() - 6 * 86_400_000).toISOString(),
    date_from: isoDate(new Date(Date.now() - 36 * 86_400_000)), date_to: isoDate(new Date(Date.now() - 6 * 86_400_000)), days: 30,
    kpis: [
      { label: "Organische klikken", value: "18.402" },
      { label: "Impressies", value: "512.086" },
      { label: "Gem. positie", value: "12,4" },
      { label: "Advertentiekosten", value: "€ 3.108,55" },
    ],
    sections: [],
  },
];

const CHANGE_LOG = [
  {
    id: "c1", at: new Date(Date.now() - 3 * 86_400_000).toISOString(), connector: "google_ads",
    account: "307-043-6491", action: "campaign_budget", title: "Dagbudget 'Search — Trouwjurken (generiek)' → € 45",
    params: { budget: 45 }, status: "uitgevoerd" as const, message: null, undone_by: null, undo_of: null,
  },
  {
    id: "c2", at: new Date(Date.now() - 9 * 86_400_000).toISOString(), connector: "google_ads",
    account: "307-043-6491", action: "negative_keywords", title: "4 zoektermen als negatief toegevoegd",
    params: { count: 4 }, status: "uitgevoerd" as const, message: null, undone_by: null, undo_of: null,
  },
];

const ADLY_ANSWER = [
  "De organische klikken zakten 8,4% ten opzichte van de vorige periode, maar dat komt volledig uit twee pagina's.",
  "",
  "• /trouwjurk-vermaken/ — 214 → 126 klikken (−41%). Positie bleef 4,2, dus de pagina verliest CTR, niet ranking.",
  "• /outlet/ — 188 → 121 klikken (−36%). Zelfde patroon: wel vertoningen, minder klikken.",
  "",
  "De advertentiecampagne 'Search — Trouwjurken (generiek)' ving dat deels op: +34 klikken, maar tegen € 1,18 CPC.",
].join("\n");

let notificationCount = 0;

export async function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  switch (command) {
    case "analytics_query": {
      const params = (args.params ?? {}) as QueryParams;
      return { rows: synthesize(params) } as unknown as T;
    }
    case "analytics_cache_stats":
      return { entries: 42, hits: 318, misses: 42, ttl_seconds: 300 } as unknown as T;
    case "analytics_cache_clear":
      return 42 as unknown as T;
    case "get_accounts":
      return ACCOUNTS as unknown as T;
    case "get_settings_status":
      return SETTINGS as unknown as T;
    case "get_brand":
      return null as unknown as T;
    case "get_dashboard_layout":
      return null as unknown as T;
    case "get_rankings":
      return RANKINGS as unknown as T;
    case "get_actions":
      return ACTIONS as unknown as T;
    case "get_report_snapshots":
      return SNAPSHOTS as unknown as T;
    case "get_change_log":
      return CHANGE_LOG as unknown as T;
    case "get_notifications":
      return false as unknown as T;
    case "adly_chat":
      return ADLY_ANSWER as unknown as T;
    case "notify_now":
      notificationCount += 1;
      console.info("[mock] melding", args.title, "—", args.body, `(#${notificationCount})`);
      return undefined as unknown as T;
    case "save_pdf":
      return "/home/bo/Downloads/adlytica-rapport.pdf" as unknown as T;
    case "test_analytics":
      return "analytics-mcp 0.4.2 · 3 connectors actief" as unknown as T;
    case "test_wordpress":
      return "White Vision" as unknown as T;
    case "analytics_login_status":
      return { phase: "ok", message: "Ingelogd", url: "" } as unknown as T;
    case "analytics_login_start":
      return "https://analytics.studiovanderheide.nl/authorize?mock=1" as unknown as T;
    case "run_audit":
    case "pagespeed":
    case "dataforseo_gap":
    case "trends_query":
    case "get_wp_seo":
      return { pages: [], tasks: [], links: [], checks: [], results: [], rows: [] } as unknown as T;
    case "track_keyword":
    case "untrack_keyword":
    case "record_rank_points":
      return RANKINGS as unknown as T;
    case "save_report_snapshot":
    case "delete_report_snapshot":
      return SNAPSHOTS as unknown as T;
    case "set_alert_settings":
      return (args.settings ?? SETTINGS.alerts) as unknown as T;
    default:
      return undefined as unknown as T;
  }
}

export function isTauri(): boolean {
  return false;
}
