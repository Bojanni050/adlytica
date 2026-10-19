import React, { useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { trendsQuery } from "../lib/api";

interface TrendsPoint {
  date: string;
  values: Record<string, number | null>;
}

export default function Trends() {
  const [keywords, setKeywords] = useState("");
  const [timeframe, setTimeframe] = useState("today 12-m");
  const [geo, setGeo] = useState("NL");
  const [points, setPoints] = useState<TrendsPoint[]>([]);
  const [related, setRelated] = useState<Record<string, Record<string, { query: string; value: number }[]>>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    const kws = keywords.split(",").map((k) => k.trim()).filter(Boolean).slice(0, 5);
    if (kws.length === 0) return;
    setLoading(true);
    setError(null);
    setPoints([]);
    setRelated({});
    try {
      const [iot, rel] = await Promise.all([
        trendsQuery({ method: "interest_over_time", keywords: kws, timeframe, geo }),
        trendsQuery({ method: "related_queries", keywords: kws, timeframe, geo }),
      ]);
      const iotTyped = iot as { points?: TrendsPoint[] };
      setPoints(iotTyped.points ?? []);
      setRelated((rel as typeof related) ?? {});
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  const chartData = points.map((p) => ({ date: p.date.slice(2), ...p.values }));
  const kwList = keywords.split(",").map((k) => k.trim()).filter(Boolean).slice(0, 5);

  return (
    <div>
      <h1>Google Trends</h1>
      <p className="subtitle">Zoekinteresse over tijd (via pytrends, max 5 termen)</p>

      <div className="toolbar">
        <input
          type="text" placeholder="bijv. meetinstrument, kalibratie" value={keywords}
          onChange={(e) => setKeywords(e.target.value)} style={{ maxWidth: 360 }}
          onKeyDown={(e) => e.key === "Enter" && search()}
        />
        <select value={timeframe} onChange={(e) => setTimeframe(e.target.value)} style={{ width: 180 }}>
          <option value="now 7-d">Afgelopen 7 dagen</option>
          <option value="today 1-m">Afgelopen maand</option>
          <option value="today 3-m">Afgelopen 3 maanden</option>
          <option value="today 12-m">Afgelopen 12 maanden</option>
          <option value="today 5-y">Afgelopen 5 jaar</option>
        </select>
        <select value={geo} onChange={(e) => setGeo(e.target.value)} style={{ width: 120 }}>
          <option value="NL">Nederland</option>
          <option value="BE">België</option>
          <option value="DE">Duitsland</option>
          <option value="">Wereldwijd</option>
        </select>
        <button className="primary" onClick={search} disabled={loading}>
          {loading ? "Laden…" : "Trends ophalen"}
        </button>
      </div>

      {error && <div className="error-box">{error}</div>}

      {chartData.length > 0 && (
        <div className="card chart-card" style={{ marginBottom: 20 }}>
          <h3>Zoekinteresse (0–100)</h3>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartData}>
              <XAxis dataKey="date" stroke="#8b96ab" fontSize={11} />
              <YAxis stroke="#8b96ab" fontSize={11} domain={[0, 100]} />
              <Tooltip contentStyle={{ background: "#1d2740", border: "1px solid #2a3550" }} />
              <Legend />
              {kwList.map((kw, i) => (
                <Line key={kw} type="monotone" dataKey={kw} stroke={["#4f8cff", "#35d0a5", "#ffb35c", "#ff6b6b", "#b47dff"][i % 5]} strokeWidth={2} dot={false} connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {Object.keys(related).length > 0 && (
        <div className="grid cols-2">
          {Object.entries(related).map(([kw, ranks]) => (
            <div className="card" key={kw}>
              <h3>Gerelateerd aan "{kw}"</h3>
              {(["top", "rising"] as const).map((rank) =>
                ranks[rank] && ranks[rank].length > 0 ? (
                  <div key={rank} style={{ marginBottom: 12 }}>
                    <div className="hint" style={{ marginBottom: 6 }}>
                      {rank === "top" ? "Top zoektermen" : "In opkomst (rising)"}
                    </div>
                    <table className="data">
                      <tbody>
                        {ranks[rank].slice(0, 10).map((q: { query: string; value: number }, i: number) => (
                          <tr key={i}>
                            <td>{q.query}</td>
                            <td className="num">{q.value}{rank === "rising" ? "%" : ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
