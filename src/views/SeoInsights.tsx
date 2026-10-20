import React, { useEffect, useMemo, useState } from "react";
import { windsorQuery, num, fmt, dateNDaysAgo, Row } from "../lib/api";

interface Props {
  accounts: Record<string, string>;
}

interface Point {
  clicks: number;
  impressions: number;
  position: number;
}

interface PagePoint {
  clicks: number;
  impressions: number;
}

interface Channel {
  name: string;
  sessions: number;
}

const DAYS = 30;

function key(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function ctrOf(point: { clicks: number; impressions: number }): number {
  return point.impressions > 0 ? (point.clicks / point.impressions) * 100 : 0;
}

function pathOf(value: unknown): string {
  const raw = String(value ?? "");
  try {
    const parsed = new URL(raw);
    const path = parsed.pathname.replace(/\/+$/, "");
    return path === "" ? "/" : path;
  } catch {
    return raw;
  }
}

function Bar({ value, max, color }: { value: number; max: number; color?: string }) {
  const width = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <span className="mini-bar">
      <span style={{ width: `${width}%`, background: color ?? "var(--accent)" }} />
    </span>
  );
}

export default function SeoInsights({ accounts }: Props) {
  const [queries, setQueries] = useState<Row[]>([]);
  const [previous, setPrevious] = useState<Row[]>([]);
  const [pages, setPages] = useState<Row[]>([]);
  const [previousPages, setPreviousPages] = useState<Row[]>([]);
  const [sources, setSources] = useState<Channel[]>([]);
  const [brand, setBrand] = useState(() => localStorage.getItem("adlytica.insights.brand") ?? "");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    localStorage.setItem("adlytica.insights.brand", brand);
  }, [brand]);

  useEffect(() => {
    let cancelled = false;
    const account = accounts.searchconsole;
    if (!account) {
      setLoading(false);
      setError("Koppel eerst Search Console bij Instellingen.");
      return;
    }

    async function load() {
      setLoading(true);
      setError(null);
      const base = { connector: "searchconsole", account };
      const [currentRows, previousRows, pageRows, previousPageRows, sourceRows] = await Promise.allSettled([
        windsorQuery({
          ...base,
          fields: ["query", "clicks", "impressions", "position"],
          date_from: dateNDaysAgo(DAYS),
          date_to: dateNDaysAgo(1),
          group_by: ["query"],
          limit: 5000,
        }),
        windsorQuery({
          ...base,
          fields: ["query", "clicks", "impressions", "position"],
          date_from: dateNDaysAgo(DAYS * 2),
          date_to: dateNDaysAgo(DAYS + 1),
          group_by: ["query"],
          limit: 5000,
        }),
        windsorQuery({
          ...base,
          fields: ["page", "clicks", "impressions", "position"],
          date_from: dateNDaysAgo(DAYS),
          date_to: dateNDaysAgo(1),
          group_by: ["page"],
          limit: 2000,
        }),
        windsorQuery({
          ...base,
          fields: ["page", "clicks", "impressions", "position"],
          date_from: dateNDaysAgo(DAYS * 2),
          date_to: dateNDaysAgo(DAYS + 1),
          group_by: ["page"],
          limit: 2000,
        }),
        accounts.googleanalytics4
          ? windsorQuery({
              connector: "googleanalytics4",
              account: accounts.googleanalytics4,
              fields: ["session_source", "sessions"],
              date_from: dateNDaysAgo(DAYS),
              date_to: dateNDaysAgo(1),
              group_by: ["session_source"],
              limit: 200,
            })
          : Promise.resolve([] as Row[]),
      ]);

      if (cancelled) return;
      const unwrap = (result: PromiseSettledResult<Row[]>): Row[] =>
        result.status === "fulfilled" ? result.value : [];

      setQueries(unwrap(currentRows));
      setPrevious(unwrap(previousRows));
      setPages(unwrap(pageRows));
      setPreviousPages(unwrap(previousPageRows));
      setSources(
        unwrap(sourceRows)
          .map((row) => ({
            name: String(row.session_source ?? "onbekend"),
            sessions: num(row.sessions),
          }))
          .filter((row) => row.sessions > 0)
          .sort((a, b) => b.sessions - a.sessions)
          .slice(0, 8)
      );

      if (currentRows.status === "rejected" && previousRows.status === "rejected" && pageRows.status === "rejected") {
        setError(String((currentRows as PromiseRejectedResult).reason));
      }
      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [accounts.searchconsole, accounts.googleanalytics4, reloadKey]);

  const model = useMemo(() => {
    const current = new Map<string, Point>();
    for (const row of queries) {
      const name = key(row.query);
      if (!name) continue;
      const existing = current.get(name) ?? { clicks: 0, impressions: 0, position: 0 };
      current.set(name, {
        clicks: existing.clicks + num(row.clicks),
        impressions: existing.impressions + num(row.impressions),
        position: existing.position + num(row.position),
      });
    }

    const before = new Map<string, Point>();
    for (const row of previous) {
      const name = key(row.query);
      if (!name) continue;
      const existing = before.get(name) ?? { clicks: 0, impressions: 0, position: 0 };
      before.set(name, {
        clicks: existing.clicks + num(row.clicks),
        impressions: existing.impressions + num(row.impressions),
        position: existing.position + num(row.position),
      });
    }

    const totals = {
      clicks: [...current.values()].reduce((sum, p) => sum + p.clicks, 0),
      impressions: [...current.values()].reduce((sum, p) => sum + p.impressions, 0),
      previousClicks: [...before.values()].reduce((sum, p) => sum + p.clicks, 0),
      previousImpressions: [...before.values()].reduce((sum, p) => sum + p.impressions, 0),
    };

    const weightedPosition =
      totals.impressions > 0
        ? [...current.values()].reduce((sum, p) => sum + p.position * p.impressions, 0) / totals.impressions
        : 0;

    // CTR-curve: de eigen cijfers van deze site per positie, niet een branchegemiddelde.
    const buckets: { label: string; impressions: number; clicks: number }[] = [];
    for (let position = 1; position <= 20; position += 1) {
      buckets.push({ label: String(position), impressions: 0, clicks: 0 });
    }
    buckets.push({ label: "21+", impressions: 0, clicks: 0 });
    for (const point of current.values()) {
      const average = point.position;
      const slot = Math.min(20, Math.max(1, Math.round(average))) - 1;
      if (average > 21) {
        buckets[20].impressions += point.impressions;
        buckets[20].clicks += point.clicks;
      } else {
        buckets[slot].impressions += point.impressions;
        buckets[slot].clicks += point.clicks;
      }
    }

    const targetCtr = (() => {
      const relevant = buckets.slice(3, 6);
      const impressions = relevant.reduce((sum, b) => sum + b.impressions, 0);
      const clicks = relevant.reduce((sum, b) => sum + b.clicks, 0);
      return impressions > 0 ? (clicks / impressions) * 100 : 3;
    })();

    const lowHanging = [...current.entries()]
      .map(([name, point]) => {
        const position = point.position;
        return { name, ...point, position };
      })
      .filter((row) => row.position >= 11 && row.position <= 20 && row.impressions > 0)
      .map((row) => ({
        ...row,
        ctr: ctrOf(row),
        gain: Math.max(0, Math.round((row.impressions * targetCtr) / 100 - row.clicks)),
      }))
      .sort((a, b) => b.gain - a.gain)
      .slice(0, 25);

    const fresh = [...current.entries()]
      .filter(([name]) => !before.has(name))
      .map(([name, point]) => ({ name, ...point, ctr: ctrOf(point) }))
      .sort((a, b) => b.impressions - a.impressions);

    const lost = [...before.entries()]
      .filter(([name]) => !current.has(name))
      .map(([name, point]) => ({ name, ...point, ctr: ctrOf(point) }))
      .sort((a, b) => b.clicks - a.clicks);

    const brandToken = brand.trim().toLowerCase();
    const branded = { clicks: 0, impressions: 0 };
    const organic = { clicks: 0, impressions: 0 };
    for (const [name, point] of current.entries()) {
      const matches = brandToken !== "" && name.includes(brandToken);
      const target = matches ? branded : organic;
      target.clicks += point.clicks;
      target.impressions += point.impressions;
    }

    const currentPages = new Map<string, PagePoint>();
    for (const row of pages) {
      const path = pathOf(row.page);
      const existing = currentPages.get(path) ?? { clicks: 0, impressions: 0 };
      currentPages.set(path, {
        clicks: existing.clicks + num(row.clicks),
        impressions: existing.impressions + num(row.impressions),
      });
    }
    const beforePages = new Map<string, PagePoint>();
    for (const row of previousPages) {
      const path = pathOf(row.page);
      const existing = beforePages.get(path) ?? { clicks: 0, impressions: 0 };
      beforePages.set(path, {
        clicks: existing.clicks + num(row.clicks),
        impressions: existing.impressions + num(row.impressions),
      });
    }

    const content = [...currentPages.entries()].map(([path, point]) => {
      const beforePoint = beforePages.get(path);
      const delta = beforePoint ? point.clicks - beforePoint.clicks : point.clicks;
      const percent =
        beforePoint && beforePoint.clicks > 0 ? (delta / beforePoint.clicks) * 100 : null;
      return { path, clicks: point.clicks, impressions: point.impressions, delta, percent, isNew: !beforePoint };
    });

    return {
      totals,
      weightedPosition,
      buckets,
      lowHanging,
      fresh,
      lost,
      branded,
      organic,
      content,
      targetCtr,
    };
  }, [queries, previous, pages, previousPages, brand]);

  const clickDelta =
    model.totals.previousClicks > 0
      ? ((model.totals.clicks - model.totals.previousClicks) / model.totals.previousClicks) * 100
      : null;

  const growing = model.content
    .filter((row) => !row.isNew && row.percent !== null && row.percent >= 20 && row.clicks >= 1)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 6);
  const declining = model.content
    .filter((row) => !row.isNew && row.percent !== null && row.percent <= -20 && row.delta <= -1)
    .sort((a, b) => a.delta - b.delta)
    .slice(0, 6);
  const newPages = model.content
    .filter((row) => row.isNew && row.clicks > 0)
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 6);

  const maxBucketImpressions = Math.max(...model.buckets.map((b) => b.impressions), 1);
  const maxBrand = Math.max(model.branded.clicks + model.organic.clicks, 1);

  return (
    <div>
      <h1>Zoekanalyse</h1>
      <p className="subtitle">
        Laatste {DAYS} dagen naast de {DAYS} dagen daarvoor · Search Console
        {accounts.googleanalytics4 ? " en GA4" : ""}
      </p>

      <div className="toolbar">
        <button className="ghost" onClick={() => setReloadKey((key) => key + 1)} disabled={loading}>
          {loading ? "Laden…" : "↻ Vernieuwen"}
        </button>
        {error && <span className="hint" style={{ color: "var(--danger)" }}>{error}</span>}
      </div>

      {loading && queries.length === 0 && <p className="hint">Zoekdata ophalen…</p>}

      {queries.length > 0 && (
        <>
          <div className="audit-kpis insights-kpis">
            <div className="card">
              <div className="stat-value">{fmt(model.totals.clicks, 0)}</div>
              <div className="stat-label">klikken</div>
              {clickDelta !== null && (
                <div className={`stat-delta ${clickDelta >= 0 ? "up" : "down"}`}>
                  {clickDelta >= 0 ? "+" : ""}{fmt(clickDelta, 1)}%
                </div>
              )}
            </div>
            <div className="card">
              <div className="stat-value">{fmt(model.totals.impressions, 0)}</div>
              <div className="stat-label">vertoningen</div>
            </div>
            <div className="card">
              <div className="stat-value">{fmt(ctrOf(model.totals), 2)}%</div>
              <div className="stat-label">CTR</div>
            </div>
            <div className="card">
              <div className="stat-value">{fmt(model.weightedPosition, 1)}</div>
              <div className="stat-label">gem. positie</div>
            </div>
            <div className="card">
              <div className="stat-value">{model.fresh.length}</div>
              <div className="stat-label">nieuwe zoektermen</div>
              <div className="stat-delta down">{model.lost.length} verloren</div>
            </div>
          </div>

          <div className="card insights-block">
            <h3>CTR per positie</h3>
            <p className="hint">
              Je eigencurve: hoeveel vertoningen en klikken je per positie haalt. De winst hiernaast
              rekent met {fmt(model.targetCtr, 1)}% CTR, het gemiddelde van je posities 4 tot 6.
            </p>
            <div className="curve">
              {model.buckets.map((bucket) => {
                const ctr = ctrOf(bucket);
                return (
                  <div className="curve-row" key={bucket.label}>
                    <span className="curve-label">{bucket.label}</span>
                    <Bar value={bucket.impressions} max={maxBucketImpressions} color="rgba(245,158,11,0.35)" />
                    <span className="curve-ctr">{bucket.impressions > 0 ? `${fmt(ctr, 1)}%` : "—"}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card insights-block">
            <h3>Low-hanging fruit (positie 11–20)</h3>
            {model.lowHanging.length === 0 ? (
              <p className="hint">Geen zoektermen in dit bereik.</p>
            ) : (
              <table className="data">
                <thead>
                  <tr>
                    <th>Zoekterm</th>
                    <th className="num">Positie</th>
                    <th className="num">Vertoningen</th>
                    <th className="num">CTR</th>
                    <th className="num">Klikken</th>
                    <th className="num">Mogelijke winst</th>
                  </tr>
                </thead>
                <tbody>
                  {model.lowHanging.map((row) => (
                    <tr key={row.name}>
                      <td>{row.name}</td>
                      <td className="num">{fmt(row.position, 1)}</td>
                      <td className="num">{fmt(row.impressions, 0)}</td>
                      <td className="num">{fmt(row.ctr, 1)}%</td>
                      <td className="num">{fmt(row.clicks, 0)}</td>
                      <td className="num" style={{ color: "var(--accent-2)" }}>+{fmt(row.gain, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="insights-split">
            <div className="card insights-block">
              <h3>Nieuwe zoektermen ({model.fresh.length})</h3>
              {model.fresh.slice(0, 8).map((row) => (
                <div className="list-row" key={row.name}>
                  <span className="list-name">{row.name}</span>
                  <span className="hint">{fmt(row.impressions, 0)} vertoningen</span>
                </div>
              ))}
              {model.fresh.length === 0 && <p className="hint">Geen nieuwe zoektermen.</p>}
            </div>
            <div className="card insights-block">
              <h3>Verloren zoektermen ({model.lost.length})</h3>
              {model.lost.slice(0, 8).map((row) => (
                <div className="list-row" key={row.name}>
                  <span className="list-name">{row.name}</span>
                  <span className="hint">{fmt(row.clicks, 0)} klikken weg</span>
                </div>
              ))}
              {model.lost.length === 0 && <p className="hint">Geen zoektermen weggevallen.</p>}
            </div>
          </div>

          <div className="card insights-block">
            <h3>Merk vs niet-merk</h3>
            <div className="toolbar" style={{ marginBottom: 10 }}>
              <input
                type="text"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="Merknaam, bijvoorbeeld white vision"
                style={{ minWidth: 260 }}
              />
              <span className="hint">Zoektermen met deze tekst gelden als merk.</span>
            </div>
            <div className="brand-split">
              <span style={{ width: `${(model.branded.clicks / maxBrand) * 100}%`, background: "var(--accent)" }} />
              <span style={{ width: `${(model.organic.clicks / maxBrand) * 100}%`, background: "rgba(245,158,11,0.25)" }} />
            </div>
            <div className="insights-split">
              <div className="list-row">
                <span className="list-name">Merk</span>
                <span className="hint">
                  {fmt(model.branded.clicks, 0)} klikken · {fmt(ctrOf(model.branded), 1)}% CTR
                </span>
              </div>
              <div className="list-row">
                <span className="list-name">Niet-merk</span>
                <span className="hint">
                  {fmt(model.organic.clicks, 0)} klikken · {fmt(ctrOf(model.organic), 1)}% CTR
                </span>
              </div>
            </div>
          </div>

          <div className="insights-split">
            <div className="card insights-block">
              <h3>Groeiende pagina's</h3>
              {growing.map((row) => (
                <div className="list-row" key={row.path}>
                  <span className="list-name" title={row.path}>{row.path}</span>
                  <span className="stat-delta up">+{fmt(row.delta, 0)}</span>
                </div>
              ))}
              {growing.length === 0 && <p className="hint">Geen groei van 20% of meer.</p>}
            </div>
            <div className="card insights-block">
              <h3>Dalende pagina's</h3>
              {declining.map((row) => (
                <div className="list-row" key={row.path}>
                  <span className="list-name" title={row.path}>{row.path}</span>
                  <span className="stat-delta down">{fmt(row.delta, 0)}</span>
                </div>
              ))}
              {declining.length === 0 && <p className="hint">Geen daling van 20% of meer.</p>}
            </div>
          </div>

          {newPages.length > 0 && (
            <div className="card insights-block">
              <h3>Nieuwe pagina's met klikken</h3>
              {newPages.map((row) => (
                <div className="list-row" key={row.path}>
                  <span className="list-name" title={row.path}>{row.path}</span>
                  <span className="hint">{fmt(row.clicks, 0)} klikken</span>
                </div>
              ))}
            </div>
          )}

          {sources.length > 0 && (
            <div className="card insights-block">
              <h3>Verkeersbronnen (GA4)</h3>
              {(() => {
                const max = Math.max(...sources.map((s) => s.sessions), 1);
                return sources.map((source) => (
                  <div className="curve-row" key={source.name}>
                    <span className="curve-label wide">{source.name}</span>
                    <Bar value={source.sessions} max={max} color="rgba(16,185,129,0.45)" />
                    <span className="curve-ctr">{fmt(source.sessions, 0)}</span>
                  </div>
                ));
              })()}
            </div>
          )}
        </>
      )}
    </div>
  );
}
