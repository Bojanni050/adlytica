import React, { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  fmt, getRankings, num, RankPoint, RankingStore, recordRankPoints,
  Row, trackKeyword, untrackKeyword, analyticsQuery,
} from "../lib/api";
import { useDateRange } from "../lib/dateRange";
import { CHART, SERIES } from "../lib/chartTheme";
import Icon from "../components/Icon";

interface Props { accounts: Record<string, string>; }

const TOOLTIP_STYLE = CHART.tooltip;

const AXIS_TICK = { fill: CHART.axis, fontSize: CHART.tickFontSize, fontFamily: "Geist Mono, monospace" };

/** Positie is beter als het getal lager is: 3 is beter dan 12. */
function bestPosition(points: RankPoint[]): number | null {
  if (points.length === 0) return null;
  return points[points.length - 1].position;
}

function positionDelta(points: RankPoint[], days = 7): number | null {
  if (points.length < 2) return null;
  const last = points[points.length - 1];
  const lastTime = new Date(last.date).getTime();
  const target = lastTime - days * 86_400_000;
  let previous: RankPoint | null = null;
  for (const point of points) {
    const time = new Date(point.date).getTime();
    if (time <= target) previous = point;
    else break;
  }
  if (!previous) previous = points[0];
  if (!previous || previous === last) return null;
  return last.position - previous.position;
}

function Sparkline({ points }: { points: RankPoint[] }) {
  if (points.length < 2) return <span className="ranking-spark" />;
  const width = 120;
  const height = 30;
  const pad = 2;
  const values = points.map((point) => point.position);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const path = values
    .map((value, index) => {
      const x = pad + (index / (values.length - 1)) * (width - pad * 2);
      // Lagere positie is beter, dus een lagere waarde komt hoger in de grafiek.
      const y = pad + ((value - min) / range) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg className="ranking-spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <polyline points={path} fill="none" stroke={SERIES.organic} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export default function Rankings({ accounts }: Props) {
  const { from, to } = useDateRange();
  const [store, setStore] = useState<RankingStore>({ tracked: [], history: {} });
  const [keyword, setKeyword] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  /** Haalt de posities uit Search Console en bewaart ze voor de gevolgde zoektermen. */
  async function sync(tracked: string[]): Promise<RankingStore> {
    if (tracked.length === 0) return store;
    const rows: Row[] = await analyticsQuery({
      connector: "searchconsole",
      account: accounts.searchconsole,
      fields: ["date", "query", "position"],
       date_from: from, date_to: to,
      group_by: ["date", "query"],
      limit: 5000,
    });
    const wanted = new Set(tracked);
    const points = rows
      .filter((row) => wanted.has(String(row.query ?? "").toLowerCase()))
      .map((row) => ({
        keyword: String(row.query ?? "").toLowerCase(),
        date: String(row.date ?? ""),
        position: num(row.position),
      }))
      .filter((point) => point.date && Number.isFinite(point.position) && point.position > 0);
    const updated = await recordRankPoints(points);
    setUpdatedAt(new Date());
    return updated;
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await getRankings();
        if (cancelled) return;
        setStore(stored);
        setSelected(stored.tracked[0] ?? null);
        if (stored.tracked.length > 0) {
          const synced = await sync(stored.tracked);
          if (!cancelled) setStore(synced);
        }
      } catch (exception) {
        if (!cancelled) setError(String(exception));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts.searchconsole, from, to]);

  async function addKeyword(value: string) {
    const term = value.trim();
    if (!term) return;
    setBusy(true);
    setError(null);
    try {
      const withKeyword = await trackKeyword(term);
      setStore(withKeyword);
      setKeyword("");
      setSelected(term.toLowerCase());
      setStore(await sync(withKeyword.tracked));
    } catch (exception) {
      setError(String(exception));
    } finally {
      setBusy(false);
    }
  }

  async function addTopKeywords() {
    setBusy(true);
    setError(null);
    try {
      const rows = await analyticsQuery({
        connector: "searchconsole",
        account: accounts.searchconsole,
        fields: ["query", "clicks", "impressions"],
         date_from: from, date_to: to,
        group_by: ["query"],
        limit: 10,
      });
      let current = await getRankings();
      for (const row of rows) {
        const term = String(row.query ?? "");
        if (!term) continue;
        current = await trackKeyword(term);
      }
      setStore(await sync(current.tracked));
      setSelected(current.tracked[0] ?? null);
    } catch (exception) {
      setError(String(exception));
    } finally {
      setBusy(false);
    }
  }

  async function removeKeyword(term: string) {
    setBusy(true);
    try {
      const updated = await untrackKeyword(term);
      setStore(updated);
      if (selected === term) setSelected(updated.tracked[0] ?? null);
    } catch (exception) {
      setError(String(exception));
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      setStore(await sync(store.tracked));
    } catch (exception) {
      setError(String(exception));
    } finally {
      setBusy(false);
    }
  }

  const rows = useMemo(() => {
    return store.tracked
      .map((term) => {
        const points = store.history[term] ?? [];
        return { term, points, position: bestPosition(points), delta: positionDelta(points) };
      })
      .sort((a, b) => {
        if (a.position === null) return 1;
        if (b.position === null) return -1;
        return a.position - b.position;
      });
  }, [store]);

  const selectedPoints = selected ? store.history[selected] ?? [] : [];
  const chartData = selectedPoints.map((point) => ({
    date: point.date.slice(5),
    positie: Number(point.position.toFixed(1)),
  }));
  const positions = selectedPoints.map((point) => point.position);
  const maxPosition = Math.max(2, Math.ceil(Math.max(...positions, 1)) + 1);
  const yDomain: [number, number] = [1, maxPosition];
  const yTicks = Array.from(new Set([1, Math.round(maxPosition / 2), maxPosition])).sort((a, b) => a - b);

  return (
    <div>
      <div className="dash-header">
        <div className="dash-heading">
          <h1>Posities</h1>
          <p className="subtitle">Dagelijkse Google-positie per gevolgde zoekterm · bewaard in rankings.json</p>
        </div>
        <div className="dash-actions">
          {updatedAt && !busy && (
            <span className="dash-updated">
              Bijgewerkt {updatedAt.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <button
            type="button"
            className="ghost icon-btn"
            onClick={refresh}
            disabled={busy || store.tracked.length === 0}
            title="Posities verversen"
            aria-label="Posities verversen"
          >
            <span className={busy ? "spin" : undefined} style={{ display: "inline-flex" }}>
              <Icon name="refresh" size={14} />
            </span>
          </button>
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="card ranking-add">
        <input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void addKeyword(keyword);
          }}
          placeholder="Zoekterm toevoegen, bijv. duikcomputer kopen"
          aria-label="Zoekterm toevoegen"
        />
        <button type="button" className="primary" onClick={() => addKeyword(keyword)} disabled={busy || !keyword.trim()}>
          Volgen
        </button>
        <button type="button" className="ghost" onClick={addTopKeywords} disabled={busy}>
          Top 10 zoektermen volgen
        </button>
      </div>

      {loading ? (
        <div className="loading">Posities laden…</div>
      ) : rows.length === 0 ? (
        <div className="card ranking-empty">
          <p>Nog geen zoektermen gevolgd.</p>
          <p className="hint">
            Voeg een zoekterm toe of volg in één klik de tien zoektermen waar je het meeste verkeer vandaan haalt.
            De posities komen uit Search Console; bij het eerste bezoek wordt de laatste 90 dagen meteen gevuld.
          </p>
        </div>
      ) : (
        <div className="ranking-layout">
          <div className="card ranking-list">
            {rows.map((row) => (
              <div
                key={row.term}
                role="button"
                tabIndex={0}
                className={selected === row.term ? "ranking-row active" : "ranking-row"}
                onClick={() => setSelected(row.term)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelected(row.term);
                  }
                }}
              >
                <span className="ranking-keyword">{row.term}</span>
                <span className="ranking-pos">{row.position === null ? "–" : fmt(row.position, 1)}</span>
                <span className={`ranking-delta ${row.delta === null ? "" : row.delta < 0 ? "up" : row.delta > 0 ? "down" : ""}`}>
                  {row.delta === null ? (
                    "nieuw"
                  ) : row.delta === 0 ? (
                    `= ${fmt(0, 1)}`
                  ) : (
                    <>
                      <Icon
                        name={row.delta < 0 ? "arrowUp" : "arrowDown"}
                        size={10}
                        strokeWidth={1.8}
                        style={{ display: "inline-block", verticalAlign: "-1px" }}
                      />{" "}
                      {fmt(Math.abs(row.delta), 1)}
                    </>
                  )}
                </span>
                <Sparkline points={row.points} />
                <button
                  type="button"
                  className="ranking-remove"
                  title="Niet meer volgen"
                  aria-label={`${row.term} niet meer volgen`}
                  onClick={(event) => {
                    event.stopPropagation();
                    void removeKeyword(row.term);
                  }}
                >
                  <Icon name="close" size={11} />
                </button>
              </div>
            ))}
            <p className="hint ranking-legend">
              Positie nu · verschil met 7 dagen geleden (lager is beter) · verloop
            </p>
          </div>

          <div className="card ranking-chart">
            <div className="ranking-chart-head">
              <h3>{selected ?? "Kies een zoekterm"}</h3>
              <span className="hint">{selectedPoints.length} dagen vastgelegd</span>
            </div>
            {chartData.length < 2 ? (
              <div className="widget-empty">Nog te weinig historie voor een grafiek</div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={chartData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke={CHART.grid} vertical={false} />
                  <XAxis dataKey="date" tick={AXIS_TICK} axisLine={false} tickLine={false} minTickGap={30} />
                  <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} reversed allowDecimals={false} domain={yDomain} ticks={yTicks} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: CHART.axis }} cursor={{ stroke: CHART.cursorLine, strokeWidth: 1 }} />
                  <Line type="monotone" dataKey="positie" stroke={SERIES.organic} strokeWidth={1.75} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
