import React, { useEffect, useId, useState } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { windsorQuery, num, fmt, dateNDaysAgo, QueryParams, Row, notifyNow } from "../lib/api";
import { exportPdf } from "../lib/pdf";
import {
  DashboardLayout, defaultLayout, loadDashboardLayout, moveVisibleWidget,
  resetDashboardLayout, reorderWidgets, saveDashboardLayout,
} from "../lib/dashboardLayout";

interface Props { accounts: Record<string, string>; }

interface DashboardData {
  gsc: Row[];
  ads: Row[];
  ga4: Row[];
  queries: Row[];
  pages: Row[];
  /** Klikken per dag per pagina, voor de anomalie-widget. */
  pageDaily: Row[];
  /** Klikken per dag per zoekterm, voor de anomalie-widget. */
  queryDaily: Row[];
  /** Impressies en posities per zoekterm per pagina, voor de cannibalisatie-widget. */
  queryPage: Row[];
}

type WidgetSpan = 2 | 3 | 4 | 6 | 12;

interface WidgetDef {
  id: string;
  title: string;
  subtitle?: string;
  span: WidgetSpan;
  category: "KPI" | "Grafiek" | "Tabel";
  render: (data: DashboardData, days: number) => React.ReactNode;
}

const TOOLTIP_STYLE: React.CSSProperties = {
  background: "#151b23",
  border: "1px solid #273140",
  borderRadius: 8,
  fontSize: 12,
  color: "#e6edf3",
  boxShadow: "0 10px 30px rgba(0, 0, 0, 0.35)",
};

const AXIS_TICK = { fill: "#8b98a8", fontSize: 11 };

/** Periodes in dagen; dezelfde waarden worden in de config bewaard. */
const RANGES = [7, 30, 90, 180];

function compact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${fmt(value / 1_000_000, 1)}M`;
  if (abs >= 1_000) return `${fmt(value / 1_000, 1)}k`;
  return fmt(value, 0);
}

function sortedByDate(rows: Row[]): Row[] {
  return [...rows].sort((a, b) => String(a.date ?? "").localeCompare(String(b.date ?? "")));
}

function series(rows: Row[], metric: string): { date: string; value: number }[] {
  return sortedByDate(rows).map((row) => ({
    date: String(row.date ?? "").slice(5),
    value: num(row[metric]),
  }));
}

function totals(rows: Row[], metric: string): number {
  return rows.reduce((sum, row) => sum + num(row[metric]), 0);
}

/** Vergelijkt de laatste `days` datadagen met de even lange periode daarvoor. */
function periodDelta(rows: Row[], metric: string, days: number): number | null {
  const times = rows
    .map((row) => new Date(String(row.date ?? "")).getTime())
    .filter((time) => Number.isFinite(time));
  if (times.length === 0) return null;
  const day = 86_400_000;
  const latest = Math.max(...times);
  const currentStart = latest - (days - 1) * day;
  const previousStart = latest - (days * 2 - 1) * day;
  let current = 0;
  let previous = 0;
  for (const row of rows) {
    const time = new Date(String(row.date ?? "")).getTime();
    if (!Number.isFinite(time)) continue;
    if (time >= currentStart) current += num(row[metric]);
    else if (time >= previousStart) previous += num(row[metric]);
  }
  if (previous === 0) return null;
  return (current - previous) / previous;
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return <div className="kpi-spark" />;
  const width = 180;
  const height = 42;
  const pad = 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values
    .map((value, index) => {
      const x = pad + (index / (values.length - 1)) * (width - pad * 2);
      const y = height - pad - ((value - min) / range) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const area = `${points} ${width - pad},${height} ${pad},${height}`;
  return (
    <svg className="kpi-spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <polygon points={area} fill={color} opacity="0.1" />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function Kpi({ rows, metric, color, days }: { rows: Row[]; metric: string; color: string; days: number }) {
  const total = totals(rows, metric);
  const delta = periodDelta(rows, metric, days);
  const trend = series(rows, metric).slice(-days).map((point) => point.value);

  return (
    <div className="kpi">
      <div className="kpi-value">{fmt(total, 0)}</div>
      <div className="kpi-meta">
        {delta === null ? (
          <span className="hint">{days} dagen totaal</span>
        ) : (
          <span className={`kpi-delta ${delta >= 0 ? "up" : "down"}`}>
            {delta >= 0 ? "▲" : "▼"} {fmt(Math.abs(delta) * 100, 1)}%
          </span>
        )}
        {delta !== null && <span className="hint">vs. vorige {days} d</span>}
      </div>
      <Sparkline values={trend} color={color} />
    </div>
  );
}

function WidgetEmpty({ children = "Geen data beschikbaar" }: { children?: React.ReactNode }) {
  return <div className="widget-empty">{children}</div>;
}

function TrendChart({
  rows, metric, color, name,
}: { rows: Row[]; metric: string; color: string; name: string }) {
  const data = series(rows, metric);
  const gradientId = useId().replace(/:/g, "");
  if (data.length === 0) return <WidgetEmpty />;

  return (
    <ResponsiveContainer width="100%" height={210}>
      <AreaChart data={data} margin={{ top: 6, right: 6, left: -16, bottom: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.28} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="rgba(39, 49, 64, 0.6)" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="date"
          tick={AXIS_TICK}
          axisLine={false}
          tickLine={false}
          minTickGap={28}
        />
        <YAxis
          tick={AXIS_TICK}
          axisLine={false}
          tickLine={false}
          width={54}
          tickFormatter={compact}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          cursor={{ stroke: "rgba(245, 158, 11, 0.35)" }}
          formatter={(value) => [fmt(Number(value), 0), name]}
        />
        <Area
          type="monotone"
          dataKey="value"
          name={name}
          stroke={color}
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          activeDot={{ r: 3, strokeWidth: 0 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function SpendChart({ rows }: { rows: Row[] }) {
  const data = series(rows, "spend");
  if (data.length === 0) return <WidgetEmpty />;

  return (
    <ResponsiveContainer width="100%" height={210}>
      <BarChart data={data} margin={{ top: 6, right: 6, left: -12, bottom: 0 }}>
        <CartesianGrid stroke="rgba(39, 49, 64, 0.6)" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="date"
          tick={AXIS_TICK}
          axisLine={false}
          tickLine={false}
          minTickGap={28}
        />
        <YAxis
          tick={AXIS_TICK}
          axisLine={false}
          tickLine={false}
          width={54}
          tickFormatter={(value) => `€${compact(Number(value))}`}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          cursor={{ fill: "rgba(251, 191, 36, 0.08)" }}
          formatter={(value) => [`€ ${fmt(Number(value), 2)}`, "Kosten"]}
        />
        <Bar dataKey="value" name="Kosten" fill="#fbbf24" radius={[3, 3, 0, 0]} maxBarSize={18} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function SessionsChart({ rows }: { rows: Row[] }) {
  const map = new Map<string, { date: string; sessies: number; gebruikers: number }>();
  for (const row of rows) {
    const key = String(row.date ?? "");
    map.set(key, {
      date: key.slice(5),
      sessies: num(row.sessions),
      gebruikers: num(row.users),
    });
  }
  const data = Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, value]) => value);
  if (data.length === 0) return <WidgetEmpty />;

  return (
    <ResponsiveContainer width="100%" height={210}>
      <LineChart data={data} margin={{ top: 6, right: 6, left: -16, bottom: 0 }}>
        <CartesianGrid stroke="rgba(39, 49, 64, 0.6)" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="date"
          tick={AXIS_TICK}
          axisLine={false}
          tickLine={false}
          minTickGap={28}
        />
        <YAxis
          tick={AXIS_TICK}
          axisLine={false}
          tickLine={false}
          width={54}
          tickFormatter={compact}
        />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value) => fmt(Number(value), 0)} />
        <Legend wrapperStyle={{ fontSize: 11, color: "#8b98a8" }} iconSize={8} />
        <Line type="monotone" dataKey="sessies" name="Sessies" stroke="#10b981" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="gebruikers" name="Gebruikers" stroke="#fbbf24" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function pathLabel(value: unknown): string {
  const raw = String(value ?? "");
  try {
    const url = new URL(raw);
    return url.pathname === "/" ? url.hostname : decodeURIComponent(url.pathname);
  } catch {
    return raw.replace(/^https?:\/\//, "");
  }
}

function TopPages({ rows }: { rows: Row[] }) {
  const top = [...rows].sort((a, b) => num(b.clicks) - num(a.clicks)).slice(0, 7);
  if (top.length === 0) return <WidgetEmpty />;

  return (
    <table className="widget-table">
      <thead>
        <tr>
          <th>Pagina</th>
          <th className="num">Klikken</th>
          <th className="num">Pos.</th>
        </tr>
      </thead>
      <tbody>
        {top.map((row, index) => (
          <tr key={`${String(row.page ?? "")}-${index}`}>
            <td className="ellipsis" title={String(row.page ?? "")}>{pathLabel(row.page)}</td>
            <td className="num">{fmt(num(row.clicks), 0)}</td>
            <td className="num">{fmt(num(row.position), 1)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TopQueries({ rows }: { rows: Row[] }) {
  const top = [...rows].sort((a, b) => num(b.clicks) - num(a.clicks)).slice(0, 7);
  if (top.length === 0) return <WidgetEmpty />;

  return (
    <table className="widget-table">
      <thead>
        <tr>
          <th>Zoekterm</th>
          <th className="num">Klikken</th>
          <th className="num">Pos.</th>
        </tr>
      </thead>
      <tbody>
        {top.map((row, index) => (
          <tr key={`${String(row.query ?? "")}-${index}`}>
            <td className="ellipsis" title={String(row.query ?? "")}>{String(row.query ?? "")}</td>
            <td className="num">{fmt(num(row.clicks), 0)}</td>
            <td className="num">{fmt(num(row.position), 1)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const ANOMALY_WINDOW = 7;
const ANOMALY_LOOKBACK = ANOMALY_WINDOW * 2 + 6;
const ANOMALY_MIN_CLICKS = 5;
const ANOMALY_MIN_DROP = 0.3;

interface Anomaly {
  key: string;
  previous: number;
  current: number;
  drop: number;
  position: number;
}

function findAnomalies(rows: Row[], field: "page" | "query"): Anomaly[] {
  const dates = Array.from(new Set(rows.map((row) => String(row.date ?? "")).filter(Boolean))).sort();
  if (dates.length < ANOMALY_WINDOW * 2) return [];

  const day = 24 * 60 * 60 * 1000;
  const latest = Date.parse(dates[dates.length - 1]);
  if (!Number.isFinite(latest)) return [];
  const currentStart = latest - (ANOMALY_WINDOW - 1) * day;
  const previousStart = latest - (ANOMALY_WINDOW * 2 - 1) * day;

  const buckets = new Map<string, { previous: number; current: number; weighted: number; weight: number }>();
  for (const row of rows) {
    const time = Date.parse(String(row.date ?? ""));
    if (!Number.isFinite(time)) continue;
    const key = String(row[field] ?? "").trim();
    if (key === "") continue;
    const clicks = num(row.clicks);
    const bucket = buckets.get(key) ?? { previous: 0, current: 0, weighted: 0, weight: 0 };
    if (time >= currentStart) {
      bucket.current += clicks;
      bucket.weighted += num(row.position) * clicks;
      bucket.weight += clicks;
    } else if (time >= previousStart) {
      bucket.previous += clicks;
    }
    buckets.set(key, bucket);
  }

  const anomalies: Anomaly[] = [];
  for (const [key, bucket] of buckets) {
    if (bucket.previous < ANOMALY_MIN_CLICKS) continue;
    const drop = (bucket.previous - bucket.current) / bucket.previous;
    if (drop < ANOMALY_MIN_DROP) continue;
    anomalies.push({
      key,
      previous: bucket.previous,
      current: bucket.current,
      drop,
      position: bucket.weight > 0 ? bucket.weighted / bucket.weight : 0,
    });
  }

  return anomalies
    .sort((a, b) => b.previous - b.current - (a.previous - a.current))
    .slice(0, 7);
}

function Anomalies({ rows, field }: { rows: Row[]; field: "page" | "query" }) {
  const anomalies = findAnomalies(rows, field);
  if (anomalies.length === 0) {
    return <WidgetEmpty>Geen opvallende dalingen in de laatste 7 dagen.</WidgetEmpty>;
  }

  return (
    <table className="widget-table">
      <thead>
        <tr>
          <th>{field === "page" ? "Pagina" : "Zoekterm"}</th>
          <th className="num">Vorige</th>
          <th className="num">Nu</th>
          <th className="num">Δ</th>
        </tr>
      </thead>
      <tbody>
        {anomalies.map((item, index) => (
          <tr key={`${item.key}-${index}`}>
            <td className="ellipsis" title={item.key}>
              {field === "page" ? pathLabel(item.key) : item.key}
            </td>
            <td className="num">{fmt(item.previous, 0)}</td>
            <td className="num">{fmt(item.current, 0)}</td>
            <td className="num">
              <span className="badge red">−{fmt(item.drop * 100, 0)}%</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const CANNIBAL_MIN_IMPRESSIONS = 200;
const CANNIBAL_PAGE_SHARE = 0.15;

interface CannibalPage {
  page: string;
  impressions: number;
  position: number;
}

interface Cannibal {
  query: string;
  impressions: number;
  pages: CannibalPage[];
}

function findCannibals(rows: Row[]): Cannibal[] {
  const grouped = new Map<string, Map<string, { impressions: number; weighted: number; weight: number }>>();

  for (const row of rows) {
    const query = String(row.query ?? "").trim();
    const page = String(row.page ?? "").trim();
    if (query === "" || page === "") continue;
    const impressions = num(row.impressions);
    const pages = grouped.get(query) ?? new Map<string, { impressions: number; weighted: number; weight: number }>();
    const entry = pages.get(page) ?? { impressions: 0, weighted: 0, weight: 0 };
    entry.impressions += impressions;
    entry.weighted += num(row.position) * impressions;
    entry.weight += impressions;
    pages.set(page, entry);
    grouped.set(query, pages);
  }

  const cannibals: Cannibal[] = [];
  for (const [query, pages] of grouped) {
    if (pages.size < 2) continue;
    const list: CannibalPage[] = Array.from(pages)
      .map(([page, entry]) => ({
        page,
        impressions: entry.impressions,
        position: entry.weight > 0 ? entry.weighted / entry.weight : 0,
      }))
      .sort((a, b) => b.impressions - a.impressions);
    const total = list.reduce((sum, item) => sum + item.impressions, 0);
    // Alleen echte concurrentie: genoeg vertoningen en de tweede pagina doet echt mee.
    if (total < CANNIBAL_MIN_IMPRESSIONS) continue;
    if (list[1].impressions < CANNIBAL_PAGE_SHARE * list[0].impressions) continue;
    cannibals.push({ query, impressions: total, pages: list.slice(0, 3) });
  }

  return cannibals.sort((a, b) => b.impressions - a.impressions).slice(0, 7);
}

function Cannibalisation({ rows }: { rows: Row[] }) {
  const cannibals = findCannibals(rows);
  if (cannibals.length === 0) {
    return <WidgetEmpty>Geen zoektermen die door meerdere pagina's worden opgevangen.</WidgetEmpty>;
  }

  return (
    <table className="widget-table">
      <thead>
        <tr>
          <th>Zoekterm</th>
          <th className="num">Impr.</th>
          <th>Pagina's (positie)</th>
        </tr>
      </thead>
      <tbody>
        {cannibals.map((item) => (
          <tr key={item.query}>
            <td className="ellipsis" title={item.query}>{item.query}</td>
            <td className="num">{fmt(item.impressions, 0)}</td>
            <td>
              <div className="cannibal-pages">
                {item.pages.map((entry) => (
                  <span
                    key={entry.page}
                    className={`cannibal-page${entry.position <= 3 ? " top3" : entry.position <= 10 ? " page1" : ""}`}
                    title={entry.page}
                  >
                    <span className="ellipsis">{pathLabel(entry.page)}</span>
                    <span className="cannibal-pos">{fmt(entry.position, 1)}</span>
                  </span>
                ))}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Opportunities({ rows }: { rows: Row[] }) {
  const opportunities = rows
    .filter((row) => num(row.position) >= 5 && num(row.position) <= 20 && num(row.impressions) > 100)
    .sort((a, b) => num(b.impressions) - num(a.impressions))
    .slice(0, 7);

  if (opportunities.length === 0) {
    return <WidgetEmpty>Geen kansen gevonden op positie 5–20.</WidgetEmpty>;
  }

  return (
    <table className="widget-table">
      <thead>
        <tr>
          <th>Zoekterm</th>
          <th className="num">Impr.</th>
          <th className="num">Pos.</th>
        </tr>
      </thead>
      <tbody>
        {opportunities.map((row, index) => (
          <tr key={`${String(row.query ?? "")}-${index}`}>
            <td className="ellipsis" title={String(row.query ?? "")}>{String(row.query ?? "")}</td>
            <td className="num">{fmt(num(row.impressions), 0)}</td>
            <td className="num">
              <span className="badge yellow">{fmt(num(row.position), 1)}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const WIDGETS: WidgetDef[] = [
  {
    id: "kpi-clicks",
    title: "Organische klikken",
    subtitle: "Search Console",
    span: 2,
    category: "KPI",
    render: (data, days) => <Kpi rows={data.gsc} metric="clicks" color="#10b981" days={days} />,
  },
  {
    id: "kpi-impressions",
    title: "Impressies",
    subtitle: "Search Console",
    span: 2,
    category: "KPI",
    render: (data, days) => <Kpi rows={data.gsc} metric="impressions" color="#34d399" days={days} />,
  },
  {
    id: "kpi-spend",
    title: "Advertentiekosten",
    subtitle: "Google Ads",
    span: 2,
    category: "KPI",
    render: (data, days) => <Kpi rows={data.ads} metric="spend" color="#f59e0b" days={days} />,
  },
  {
    id: "kpi-conversions",
    title: "Conversies",
    subtitle: "Google Ads",
    span: 2,
    category: "KPI",
    render: (data, days) => <Kpi rows={data.ads} metric="conversions" color="#fbbf24" days={days} />,
  },
  {
    id: "kpi-sessions",
    title: "Sessies",
    subtitle: "GA4",
    span: 2,
    category: "KPI",
    render: (data, days) => <Kpi rows={data.ga4} metric="sessions" color="#10b981" days={days} />,
  },
  {
    id: "kpi-users",
    title: "Gebruikers",
    subtitle: "GA4",
    span: 2,
    category: "KPI",
    render: (data, days) => <Kpi rows={data.ga4} metric="users" color="#fbbf24" days={days} />,
  },
  {
    id: "chart-organic",
    title: "Organische klikken per dag",
    subtitle: "Search Console · dagelijkse trend",
    span: 6,
    category: "Grafiek",
    render: (data) => <TrendChart rows={data.gsc} metric="clicks" color="#10b981" name="Klikken" />,
  },
  {
    id: "chart-paid",
    title: "Betaalde klikken per dag",
    subtitle: "Google Ads · dagelijkse trend",
    span: 6,
    category: "Grafiek",
    render: (data) => <TrendChart rows={data.ads} metric="clicks" color="#f59e0b" name="Klikken" />,
  },
  {
    id: "chart-spend",
    title: "Advertentiekosten per dag",
    subtitle: "Google Ads · besteed budget",
    span: 6,
    category: "Grafiek",
    render: (data) => <SpendChart rows={data.ads} />,
  },
  {
    id: "chart-sessions",
    title: "Sessies en gebruikers",
    subtitle: "GA4 · dagelijks",
    span: 6,
    category: "Grafiek",
    render: (data) => <SessionsChart rows={data.ga4} />,
  },
  {
    id: "table-pages",
    title: "Top pagina's",
    subtitle: "Search Console · klikken",
    span: 4,
    category: "Tabel",
    render: (data) => <TopPages rows={data.pages} />,
  },
  {
    id: "table-queries",
    title: "Top zoektermen",
    subtitle: "Search Console · klikken",
    span: 4,
    category: "Tabel",
    render: (data) => <TopQueries rows={data.queries} />,
  },
  {
    id: "opportunities",
    title: "SEO-kansen",
    subtitle: "Positie 5–20 met veel vertoningen",
    span: 4,
    category: "Tabel",
    render: (data) => <Opportunities rows={data.queries} />,
  },
  {
    id: "anomaly-pages",
    title: "Anomalieën — pagina's",
    subtitle: "Week-op-week daling vanaf 30%",
    span: 4,
    category: "Tabel",
    render: (data) => <Anomalies rows={data.pageDaily} field="page" />,
  },
  {
    id: "anomaly-queries",
    title: "Anomalieën — zoektermen",
    subtitle: "Week-op-week daling vanaf 30%",
    span: 4,
    category: "Tabel",
    render: (data) => <Anomalies rows={data.queryDaily} field="query" />,
  },
  {
    id: "cannibalisation",
    title: "Cannibalisatie",
    subtitle: "Zoektermen die meerdere pagina's opvangen",
    span: 6,
    category: "Tabel",
    render: (data) => <Cannibalisation rows={data.queryPage} />,
  },
];

const WIDGET_IDS = WIDGETS.map((widget) => widget.id);

function WidgetSkeleton({ span }: { span: WidgetSpan }) {
  return (
    <div className={`widget-skeleton${span <= 2 ? " compact" : ""}`}>
      <div className="skeleton-line" style={{ width: "38%" }} />
      <div className="skeleton-line tall" style={{ width: span <= 2 ? "62%" : "28%" }} />
      {span > 2 && <div className="skeleton-block" />}
    </div>
  );
}

interface WidgetFrameProps {
  def: WidgetDef;
  editMode: boolean;
  loading: boolean;
  dragging: boolean;
  dragOver: boolean;
  index: number;
  visibleCount: number;
  onHide: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onDragStart: (event: React.DragEvent, id: string) => void;
  onDragOver: (event: React.DragEvent, id: string) => void;
  onDragLeave: (event: React.DragEvent, id: string) => void;
  onDrop: (event: React.DragEvent, id: string) => void;
  onDragEnd: () => void;
  children: React.ReactNode;
}

function WidgetFrame({
  def, editMode, loading, dragging, dragOver, index, visibleCount,
  onHide, onMove, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd, children,
}: WidgetFrameProps) {
  return (
    <section
      className={[
        "widget",
        editMode ? "editing" : "",
        dragging ? "dragging" : "",
        dragOver ? "drag-over" : "",
      ].filter(Boolean).join(" ")}
      data-span={def.span}
      data-kind={def.category}
      draggable={editMode}
      onDragStart={(event) => onDragStart(event, def.id)}
      onDragOver={(event) => onDragOver(event, def.id)}
      onDragLeave={(event) => onDragLeave(event, def.id)}
      onDrop={(event) => onDrop(event, def.id)}
      onDragEnd={onDragEnd}
    >
      <header className="widget-head">
        {editMode && <span className="widget-grip" aria-hidden="true">⠿</span>}
        <div className="widget-heading">
          <h3 className="widget-title">{def.title}</h3>
          {def.subtitle && <p className="widget-subtitle">{def.subtitle}</p>}
        </div>
      </header>
      <div className="widget-body">
        {loading ? <WidgetSkeleton span={def.span} /> : children}
      </div>
      {editMode && (
        <div className="widget-editbar">
          <button
            type="button"
            className="widget-tool"
            onClick={() => onMove(def.id, -1)}
            disabled={index === 0}
            title="Widget naar links"
            aria-label="Widget naar links"
          >
            ‹
          </button>
          <button
            type="button"
            className="widget-tool"
            onClick={() => onMove(def.id, 1)}
            disabled={index === visibleCount - 1}
            title="Widget naar rechts"
            aria-label="Widget naar rechts"
          >
            ›
          </button>
          <span className="widget-editbar-hint">
            {def.span <= 2 ? "" : "Sleep om te verplaatsen"}
          </span>
          <button
            type="button"
            className="widget-tool hide"
            onClick={() => onHide(def.id)}
            title="Widget verbergen"
            aria-label="Widget verbergen"
          >
            {def.span <= 2 ? "✕" : "✕ Verbergen"}
          </button>
        </div>
      )}
    </section>
  );
}

export default function Dashboard({ accounts }: Props) {
  const [data, setData] = useState<DashboardData>({ gsc: [], ads: [], ga4: [], queries: [], pages: [], pageDaily: [], queryDaily: [], queryPage: [] });
  const [loading, setLoading] = useState(true);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfMsg, setPdfMsg] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [layout, setLayout] = useState<DashboardLayout>(() => defaultLayout(WIDGET_IDS));
  const [layoutLoaded, setLayoutLoaded] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const rangeDays = layout.rangeDays ?? 90;

  // De indeling staat in config.json (via de Rust-kant); pas opslaan nadat die is gelezen,
  // anders overschrijft de standaardindeling de bewaarde keuze.
  useEffect(() => {
    let cancelled = false;
    loadDashboardLayout(WIDGET_IDS).then((stored) => {
      if (cancelled) return;
      setLayout(stored);
      setLayoutLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!layoutLoaded) return;
    void saveDashboardLayout(layout);
  }, [layout, layoutLoaded]);

  useEffect(() => {
    if (!layoutLoaded) return;
    let cancelled = false;
    const errors: string[] = [];

    async function safeQuery(params: QueryParams): Promise<Row[]> {
      try {
        return await windsorQuery(params);
      } catch (exception) {
        errors.push(String(exception));
        return [];
      }
    }

    async function load() {
      setLoading(true);
      setError(null);
      const from = dateNDaysAgo(rangeDays - 1);
      const anomalyFrom = dateNDaysAgo(ANOMALY_LOOKBACK - 1);
      const [gsc, ads, ga4, queries, pages, pageDaily, queryDaily, queryPage] = await Promise.all([
        safeQuery({
          connector: "searchconsole", account: accounts.searchconsole,
          fields: ["date", "clicks", "impressions", "ctr", "position"],
          date_from: from, group_by: ["date"], limit: 5000,
        }),
        safeQuery({
          connector: "google_ads", account: accounts.google_ads,
          fields: ["date", "clicks", "impressions", "spend", "conversions"],
          date_from: from, group_by: ["date"], limit: 5000,
        }),
        safeQuery({
          connector: "googleanalytics4", account: accounts.googleanalytics4,
          fields: ["date", "sessions", "users", "screen_page_views"],
          date_from: from, group_by: ["date"], limit: 5000,
        }),
        safeQuery({
          connector: "searchconsole", account: accounts.searchconsole,
          fields: ["query", "clicks", "impressions", "ctr", "position"],
          date_from: from, group_by: ["query"], limit: 500,
        }),
        safeQuery({
          connector: "searchconsole", account: accounts.searchconsole,
          fields: ["page", "clicks", "impressions", "ctr", "position"],
          date_from: from, group_by: ["page"], limit: 500,
        }),
        safeQuery({
          connector: "searchconsole", account: accounts.searchconsole,
          fields: ["date", "page", "clicks", "position"],
          date_from: anomalyFrom, group_by: ["date", "page"], limit: 5000,
        }),
        safeQuery({
          connector: "searchconsole", account: accounts.searchconsole,
          fields: ["date", "query", "clicks", "position"],
          date_from: anomalyFrom, group_by: ["date", "query"], limit: 5000,
        }),
        safeQuery({
          connector: "searchconsole", account: accounts.searchconsole,
          fields: ["query", "page", "clicks", "impressions", "position"],
          date_from: dateNDaysAgo(89), group_by: ["query", "page"], limit: 5000,
        }),
      ]);
      if (cancelled) return;
      setData({ gsc, ads, ga4, queries, pages, pageDaily, queryDaily, queryPage });
      setError(errors.length > 0 ? errors[0] : null);
      setUpdatedAt(new Date());
      setLoading(false);
      setLoadedOnce(true);

      // Eén melding per dag, alleen als er echt iets opvalt.
      try {
        const pageDrops = findAnomalies(pageDaily, "page").length;
        const queryDrops = findAnomalies(queryDaily, "query").length;
        const total = pageDrops + queryDrops;
        if (total > 0) {
          const dayKey = `adlytica.notified.${new Date().toISOString().slice(0, 10)}`;
          if (localStorage.getItem(dayKey) !== String(total)) {
            localStorage.setItem(dayKey, String(total));
            const parts: string[] = [];
            if (pageDrops > 0) parts.push(`${pageDrops} pagina${pageDrops === 1 ? "" : "'s"}`);
            if (queryDrops > 0) parts.push(`${queryDrops} zoekterm${queryDrops === 1 ? "" : "en"}`);
            void notifyNow(
              "Adlytica — dalingen deze week",
              `${parts.join(" en ")} zakten met 30% of meer. Open het dashboard voor de details.`
            ).catch(() => undefined);
          }
        }
      } catch {
        // Een mislukte melding mag het dashboard nooit blokkeren.
      }
    }

    load();
    return () => { cancelled = true; };
  }, [accounts, reloadKey, rangeDays, layoutLoaded]);

  const visibleWidgets = layout.order
    .filter((id) => !layout.hidden.includes(id))
    .map((id) => WIDGETS.find((widget) => widget.id === id))
    .filter((widget): widget is WidgetDef => Boolean(widget));

  function toggleWidget(id: string) {
    setLayout((current) => ({
      ...current,
      hidden: current.hidden.includes(id)
        ? current.hidden.filter((item) => item !== id)
        : [...current.hidden, id],
    }));
  }

  function moveWidget(id: string, direction: -1 | 1) {
    setLayout((current) => ({
      ...current,
      order: moveVisibleWidget(current.order, current.hidden, id, direction),
    }));
  }

  function handleDragStart(event: React.DragEvent, id: string) {
    setDragId(id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
  }

  function handleDragOver(event: React.DragEvent, id: string) {
    if (!dragId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (overId !== id) setOverId(id);
  }

  function handleDragLeave(event: React.DragEvent, id: string) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    if (overId === id) setOverId(null);
  }

  function handleDrop(event: React.DragEvent, id: string) {
    event.preventDefault();
    if (dragId) {
      setLayout((current) => ({
        ...current,
        order: reorderWidgets(current.order, dragId, id),
      }));
    }
    setDragId(null);
    setOverId(null);
  }

  function handleDragEnd() {
    setDragId(null);
    setOverId(null);
  }

  function resetLayout() {
    void resetDashboardLayout(WIDGET_IDS).then(setLayout);
  }

  const showSkeleton = loading && !loadedOnce;
  const hiddenCount = layout.hidden.length;

  function setRange(days: number) {
    setLayout((current) => ({ ...current, rangeDays: days }));
  }

  async function exportReport() {
    setPdfBusy(true);
    setPdfMsg(null);
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      const topPages = [...data.pages]
        .sort((a, b) => num(b.clicks) - num(a.clicks))
        .slice(0, 10)
        .map((r) => [
          pathLabel(r.page), fmt(num(r.clicks), 0), fmt(num(r.impressions), 0),
          `${fmt(num(r.ctr), 1)}%`, fmt(num(r.position), 1),
        ]);
      const topQueries = [...data.queries]
        .sort((a, b) => num(b.clicks) - num(a.clicks))
        .slice(0, 10)
        .map((r) => [
          String(r.query ?? ""), fmt(num(r.clicks), 0), fmt(num(r.impressions), 0),
          `${fmt(num(r.ctr), 1)}%`, fmt(num(r.position), 1),
        ]);
      const drops = [...findAnomalies(data.pageDaily, "page"), ...findAnomalies(data.queryDaily, "query")]
        .slice(0, 10)
        .map((item) => [
          pathLabel(item.key), fmt(item.previous, 0), fmt(item.current, 0),
          `−${Math.round(item.drop * 100)}%`, fmt(item.position, 1),
        ]);

      const path = await exportPdf({
        title: "Dashboard",
        subtitle: `Search Console, Google Ads en GA4 · laatste ${rangeDays} dagen`,
        kpis: [
          { label: "Organische klikken", value: fmt(totals(data.gsc, "clicks"), 0) },
          { label: "Impressies", value: fmt(totals(data.gsc, "impressions"), 0) },
          { label: "Advertentiekosten", value: `€ ${fmt(totals(data.ads, "spend"), 2)}` },
          { label: "Conversies", value: fmt(totals(data.ads, "conversions"), 0) },
          { label: "Sessies", value: fmt(totals(data.ga4, "sessions"), 0) },
          { label: "Gebruikers", value: fmt(totals(data.ga4, "users"), 0) },
        ],
        sections: [
          { title: "Top pagina's", head: ["Pagina", "Klikken", "Impressies", "CTR", "Positie"], rows: topPages },
          { title: "Top zoektermen", head: ["Zoekterm", "Klikken", "Impressies", "CTR", "Positie"], rows: topQueries },
          {
            title: "Dalingen week-op-week",
            head: ["Pagina of zoekterm", "Vorige week", "Deze week", "Daling", "Positie"],
            rows: drops,
            note: drops.length === 0 ? "Geen dalingen van 30% of meer gevonden." : undefined,
          },
        ],
        filename: `adlytica-dashboard-${stamp}.pdf`,
      });
      setPdfMsg(`Opgeslagen: ${path}`);
    } catch (e) {
      setPdfMsg(null);
      setError(String(e));
    } finally {
      setPdfBusy(false);
    }
  }

  return (
    <div className={editMode ? "dashboard edit-mode" : "dashboard"}>
      <div className="dash-header">
        <div className="dash-heading">
          <h1>Dashboard</h1>
          <p className="subtitle">Search Console, Google Ads en GA4 · laatste {rangeDays} dagen</p>
        </div>
        <div className="dash-actions">
          <div className="range-switch" role="group" aria-label="Periode">
            {RANGES.map((days) => (
              <button
                key={days}
                type="button"
                className={days === rangeDays ? "range-option active" : "range-option"}
                onClick={() => setRange(days)}
                aria-pressed={days === rangeDays}
              >
                {days}d
              </button>
            ))}
          </div>
          {updatedAt && !loading && (
            <span className="dash-updated">
              Bijgewerkt {updatedAt.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          {pdfMsg && (
            <span className="dash-updated" title={pdfMsg}>PDF opgeslagen</span>
          )}
          <button
            type="button"
            className="ghost icon-btn"
            onClick={() => setReloadKey((key) => key + 1)}
            disabled={loading}
            title="Data verversen"
            aria-label="Data verversen"
          >
            <span className={loading ? "spin" : undefined}>↻</span>
          </button>
          <button
            type="button"
            className="ghost"
            onClick={exportReport}
            disabled={pdfBusy || !loadedOnce}
            title="Rapport als PDF opslaan"
          >
            {pdfBusy ? "PDF…" : "⬇ PDF"}
          </button>
          {editMode ? (
            <>
              <button type="button" className="ghost" onClick={() => setManagerOpen((open) => !open)}>
                Widgets <span className="count-pill">{WIDGETS.length - hiddenCount}</span>
              </button>
              <button type="button" className="ghost" onClick={resetLayout}>Standaard</button>
              <button type="button" className="primary" onClick={() => setEditMode(false)}>Gereed</button>
            </>
          ) : (
            <button type="button" className="primary" onClick={() => setEditMode(true)}>
              ✎ Dashboard aanpassen
            </button>
          )}
        </div>
      </div>

      {editMode && (
        <div className="edit-bar">
          <span className="edit-dot" />
          <span>Bewerkmodus — sleep widgets om ze te verplaatsen en verberg ze met ✕.</span>
          <button type="button" className="link-btn" onClick={() => setManagerOpen(true)}>
            Widgets beheren
          </button>
        </div>
      )}

      {managerOpen && (
        <div className="widget-manager">
          <div className="wm-head">
            <div>
              <strong>Widgets</strong>
              <p className="hint">Zet widgets aan of uit. De volgorde wijzig je door ze te slepen.</p>
            </div>
            <button type="button" className="ghost" onClick={() => setManagerOpen(false)}>Sluiten</button>
          </div>
          <div className="wm-list">
            {WIDGETS.map((widget) => {
              const active = !layout.hidden.includes(widget.id);
              return (
                <button
                  type="button"
                  key={widget.id}
                  className={`wm-item${active ? " on" : ""}`}
                  onClick={() => toggleWidget(widget.id)}
                  aria-pressed={active}
                >
                  <span className="wm-check">{active ? "✓" : ""}</span>
                  <span className="wm-label">{widget.title}</span>
                </button>
              );
            })}
          </div>
          <div className="wm-foot">
            <span className="hint">
              {hiddenCount === 0 ? "Alle widgets zijn zichtbaar" : `${hiddenCount} widget${hiddenCount === 1 ? "" : "s"} verborgen`}
            </span>
            <button
              type="button"
              className="ghost"
              onClick={() => setLayout((current) => ({ ...current, hidden: [] }))}
            >
              Alles tonen
            </button>
          </div>
        </div>
      )}

      {error && <div className="error-box">{error}</div>}

      {visibleWidgets.length === 0 ? (
        <div className="dash-empty">
          <div className="dash-empty-icon">▦</div>
          <h2>Je dashboard is leeg</h2>
          <p className="hint">Voeg widgets toe om je SEO- en advertentiecijfers weer te zien.</p>
          <button type="button" className="primary" onClick={() => { setEditMode(true); setManagerOpen(true); }}>
            Widgets toevoegen
          </button>
        </div>
      ) : (
        <div className="widget-grid">
          {visibleWidgets.map((widget, index) => (
            <WidgetFrame
              key={widget.id}
              def={widget}
              editMode={editMode}
              loading={showSkeleton}
              dragging={dragId === widget.id}
              dragOver={overId === widget.id && dragId !== widget.id}
              index={index}
              visibleCount={visibleWidgets.length}
              onHide={toggleWidget}
              onMove={moveWidget}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onDragEnd={handleDragEnd}
            >
              {widget.render(data, rangeDays)}
            </WidgetFrame>
          ))}
        </div>
      )}
    </div>
  );
}
