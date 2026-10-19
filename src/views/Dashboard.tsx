import React, { useEffect, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { windsorQuery, num, fmt, pct, dateNDaysAgo, Row } from "../lib/api";

interface Props { accounts: Record<string, string>; }

export default function Dashboard({ accounts }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ source: string; metric: string; value: number; rows: number }[]>([]);
  const [gscDaily, setGscDaily] = useState<Row[]>([]);
  const [adsDaily, setAdsDaily] = useState<Row[]>([]);
  const [ga4Daily, setGa4Daily] = useState<Row[]>([]);

  useEffect(() => {
    const from = dateNDaysAgo(89);
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [gsc, ads, ga4] = await Promise.all([
          windsorQuery({
            connector: "searchconsole", account: accounts.searchconsole,
            fields: ["date", "clicks", "impressions", "ctr", "position"],
            date_from: from, group_by: ["date"], limit: 5000,
          }),
          windsorQuery({
            connector: "google_ads", account: accounts.google_ads,
            fields: ["date", "clicks", "impressions", "spend", "conversions"],
            date_from: from, group_by: ["date"], limit: 5000,
          }),
          windsorQuery({
            connector: "googleanalytics4", account: accounts.googleanalytics4,
            fields: ["date", "sessions", "users", "screen_page_views"],
            date_from: from, group_by: ["date"], limit: 5000,
          }),
        ]);
        setGscDaily(gsc);
        setAdsDaily(ads);
        setGa4Daily(ga4);
        setSummary([
          { source: "Search Console", metric: "Klikken (90d)", value: gsc.reduce((s, r) => s + num(r.clicks), 0), rows: gsc.length },
          { source: "Search Console", metric: "Impressies (90d)", value: gsc.reduce((s, r) => s + num(r.impressions), 0), rows: gsc.length },
          { source: "Google Ads", metric: "Kosten (90d)", value: ads.reduce((s, r) => s + num(r.spend), 0), rows: ads.length },
          { source: "Google Ads", metric: "Conversies (90d)", value: ads.reduce((s, r) => s + num(r.conversions), 0), rows: ads.length },
          { source: "GA4", metric: "Sessies (90d)", value: ga4.reduce((s, r) => s + num(r.sessions), 0), rows: ga4.length },
          { source: "GA4", metric: "Gebruikers (90d)", value: ga4.reduce((s, r) => s + num(r.users), 0), rows: ga4.length },
        ]);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [accounts]);

  function mergeDaily(primary: Row[], key: string): Row[] {
    const map = new Map<string, Row>();
    for (const r of primary) {
      const d = String(r.date ?? r.day ?? "");
      map.set(d, { date: d.slice(5), [key]: num(r.clicks) });
    }
    return Array.from(map.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }

  const organicChart = mergeDaily(gscDaily, "clicks");
  const paidChart = mergeDaily(adsDaily, "clicks");

  if (loading) return <div className="loading">Data laden…</div>;

  return (
    <div>
      <h1>Dashboard</h1>
      <p className="subtitle">Laatste 90 dagen — Search Console, Google Ads en GA4</p>
      {error && <div className="error-box">{error}</div>}

      <div className="grid cols-3" style={{ marginBottom: 20 }}>
        {summary.map((s, i) => (
          <div className="card" key={i}>
            <div className="stat-label">{s.source} · {s.metric}</div>
            <div className="stat-value">{fmt(s.value, 0)}</div>
            <div className="hint">{s.rows} dagen met data</div>
          </div>
        ))}
      </div>

      <div className="grid cols-2">
        <div className="card chart-card">
          <h3>Organische klikken (Search Console)</h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={organicChart}>
              <XAxis dataKey="date" stroke="#8b96ab" fontSize={11} />
              <YAxis stroke="#8b96ab" fontSize={11} />
              <Tooltip contentStyle={{ background: "#1d2740", border: "1px solid #2a3550" }} />
              <Line type="monotone" dataKey="clicks" stroke="#35d0a5" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="card chart-card">
          <h3>Betaalde klikken (Google Ads)</h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={paidChart}>
              <XAxis dataKey="date" stroke="#8b96ab" fontSize={11} />
              <YAxis stroke="#8b96ab" fontSize={11} />
              <Tooltip contentStyle={{ background: "#1d2740", border: "1px solid #2a3550" }} />
              <Line type="monotone" dataKey="clicks" stroke="#4f8cff" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
