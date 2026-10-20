import React, { useMemo, useState } from "react";
import { dataforseoGap, GapResult } from "../lib/api";
import { fmt } from "../lib/api";

const LIMITS = [100, 500, 1000];

function rankClass(rank: number | null): string {
  if (rank === null) return "badge blue";
  if (rank <= 3) return "badge green";
  if (rank <= 10) return "badge blue";
  if (rank <= 20) return "badge yellow";
  return "badge red";
}

export default function Competitors() {
  const [own, setOwn] = useState(() => localStorage.getItem("adlytica.gap.own") ?? "");
  const [others, setOthers] = useState(() => localStorage.getItem("adlytica.gap.others") ?? "");
  const [limit, setLimit] = useState(() => Number(localStorage.getItem("adlytica.gap.limit") ?? 500));
  const [result, setResult] = useState<GapResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [minVolume, setMinVolume] = useState(0);

  async function compare() {
    if (busy) return;
    const domains = [own, ...others.split(/[,\n;]/)].map((value) => value.trim()).filter(Boolean);
    if (domains.length < 2) {
      setError("Vul je eigen domein en minimaal één concurrent in.");
      return;
    }
    setBusy(true);
    setError(null);
    localStorage.setItem("adlytica.gap.own", own.trim());
    localStorage.setItem("adlytica.gap.others", others.trim());
    localStorage.setItem("adlytica.gap.limit", String(limit));
    try {
      const gap = await dataforseoGap(domains, limit);
      setResult(gap);
    } catch (e) {
      setResult(null);
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const rows = useMemo(() => {
    if (!result) return [];
    const needle = search.trim().toLowerCase();
    return result.rows
      .filter((row) => row.volume >= minVolume)
      .filter((row) => (needle === "" ? true : row.keyword.toLowerCase().includes(needle)))
      .slice(0, 200);
  }, [result, search, minVolume]);

  return (
    <div>
      <h1>Concurrenten</h1>
      <p className="subtitle">
        Keywords waar een concurrent wel op rankt en jij niet. Komt uit de DataForSEO Labs-index —
        de enige betaalde bron in de app, dus je ziet vooraf en achteraf wat een run kost.
      </p>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="form-row">
          <div>
            <label className="field">Jouw domein</label>
            <input
              type="text"
              value={own}
              onChange={(e) => setOwn(e.target.value)}
              placeholder="white-vision.nl"
            />
          </div>
          <div>
            <label className="field">Concurrenten (komma's)</label>
            <input
              type="text"
              value={others}
              onChange={(e) => setOthers(e.target.value)}
              placeholder="concurrent.nl, nogeen.nl"
            />
          </div>
        </div>
        <div className="toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
          <select
            value={limit}
            onChange={(e) => {
              const value = Number(e.target.value);
              setLimit(value);
              localStorage.setItem("adlytica.gap.limit", String(value));
            }}
          >
            {LIMITS.map((value) => (
              <option key={value} value={value}>
                {value} keywords per domein
              </option>
            ))}
          </select>
          <button className="primary" onClick={compare} disabled={busy}>
            {busy ? "Bezig…" : "Vergelijk"}
          </button>
          <span className="hint" style={{ margin: 0 }}>
            Ongeveer $0,01–$0,13 per domein bij {limit} keywords.
          </span>
        </div>
      </div>

      {error && <p className="hint" style={{ color: "var(--danger)" }}>{error}</p>}
      {busy && <p className="hint">DataForSEO ophalen. Dit duurt een paar seconden per domein.</p>}

      {!result && !busy && (
        <div className="card">
          <h3>Wat je krijgt</h3>
          <ul className="audit-list">
            <li>Keywords die jouw domein niet heeft, met het zoekvolume en de positie per concurrent.</li>
            <li>Eén Labs-taak per domein; de werkelijke kosten staan na de run in de kop.</li>
            <li>Zonder DataForSEO-login blijft deze view leeg — de rest van de app werkt zonder.</li>
          </ul>
        </div>
      )}

      {result && (
        <>
          <div className="audit-kpis" style={{ marginBottom: 14 }}>
            <div className="card">
              <div className="stat-value">{result.rows.length}</div>
              <div className="stat-label">keywords die je mist</div>
            </div>
            <div className="card">
              <div className="stat-value">{fmt(result.gap_volume, 0)}</div>
              <div className="stat-label">zoekvolume per maand</div>
            </div>
            <div className="card">
              <div className="stat-value">{result.domains.length}</div>
              <div className="stat-label">domeinen vergeleken</div>
            </div>
            <div className="card">
              <div className="stat-value">$ {fmt(result.cost, 3)}</div>
              <div className="stat-label">kosten van deze run</div>
            </div>
          </div>

          <p className="hint">
            {result.domains.map((domain, index) => `${domain}: ${result.found[index]} keywords`).join(" · ")}
          </p>

          <div className="toolbar">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Zoek in keywords"
              className="grow"
            />
            <select value={minVolume} onChange={(e) => setMinVolume(Number(e.target.value))}>
              <option value={0}>elk volume</option>
              <option value={50}>vanaf 50</option>
              <option value={100}>vanaf 100</option>
              <option value={500}>vanaf 500</option>
            </select>
          </div>

          <table className="data">
            <thead>
              <tr>
                <th>Zoekterm</th>
                <th className="num">Volume /mnd</th>
                {result.domains.map((domain, index) => (
                  <th key={domain} className="num">
                    {index === 0 ? `${domain} (jij)` : domain}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.keyword}>
                  <td>{row.keyword}</td>
                  <td className="num">{fmt(row.volume, 0)}</td>
                  {row.ranks.map((rank, index) => (
                    <td key={`${row.keyword}-${index}`} className="num">
                      {rank === null ? (
                        <span className="hint" style={{ margin: 0 }}>—</span>
                      ) : (
                        <span className={rankClass(rank)}>#{rank}</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>

          {rows.length === 0 && <p className="hint">Geen keywords die bij dit filter passen.</p>}
          {result.rows.length > rows.length && (
            <p className="hint">Eerste {rows.length} van {result.rows.length} keywords.</p>
          )}
        </>
      )}
    </div>
  );
}
