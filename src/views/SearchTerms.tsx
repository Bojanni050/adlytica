import React, { useEffect, useMemo, useState } from "react";
import { windsorAction, windsorQuery, num, fmt, dateNDaysAgo, Row } from "../lib/api";

interface Props { accounts: Record<string, string>; }

type MatchType = "BROAD" | "PHRASE" | "EXACT";

interface TermRow {
  key: string;
  term: string;
  campaignId: string;
  campaignName: string;
  adGroupName: string;
  clicks: number;
  impressions: number;
  spend: number;
  conversions: number;
}

const RANGES = [30, 90];

function toRows(rows: Row[]): TermRow[] {
  return rows.map((r, index) => {
    const term = String(r.search_term ?? "").trim();
    const campaignId = String(r.campaign_id ?? "");
    return {
      key: `${campaignId}::${term}::${index}`,
      term,
      campaignId,
      campaignName: String(r.campaign_name ?? "Onbekende campagne"),
      adGroupName: String(r.ad_group_name ?? ""),
      clicks: num(r.clicks),
      impressions: num(r.impressions),
      spend: num(r.spend),
      conversions: num(r.conversions),
    };
  });
}

/** Beoordeelt een zoekterm op basis van kosten en conversies. */
function suggestion(row: TermRow, minSpend: number): { label: string; cls: string; why: string } {
  if (row.conversions > 0) return { label: "Conversie", cls: "green", why: "Leverde conversies op" };
  if (row.spend >= minSpend) {
    return {
      label: "Negative",
      cls: "red",
      why: row.clicks > 0 ? "Kosten zonder conversies" : "Kosten zonder klikken",
    };
  }
  if (row.clicks >= 3) return { label: "Zwak", cls: "yellow", why: "Klikken zonder conversies" };
  return { label: "Weinig data", cls: "blue", why: "Te weinig volume om te beoordelen" };
}

function ctr(row: TermRow): number {
  return row.impressions > 0 ? (row.clicks / row.impressions) * 100 : 0;
}

export default function SearchTerms({ accounts }: Props) {
  const [rows, setRows] = useState<TermRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [minSpend, setMinSpend] = useState("1");
  const [filter, setFilter] = useState("");
  const [onlyCandidates, setOnlyCandidates] = useState(true);
  const [selected, setSelected] = useState<Record<string, TermRow>>({});
  const [matchType, setMatchType] = useState<MatchType>("PHRASE");
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await windsorQuery({
          connector: "google_ads",
          account: accounts.google_ads,
          fields: [
            "search_term",
            "campaign_id", "campaign_name",
            "ad_group_id", "ad_group_name",
            "clicks", "impressions", "spend", "conversions",
          ],
          date_from: dateNDaysAgo(days - 1),
          group_by: ["search_term", "campaign_id", "campaign_name", "ad_group_id", "ad_group_name"],
          limit: 3000,
        });
        if (!cancelled) setRows(toRows(data));
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [accounts, days, reloadKey]);

  const threshold = Math.max(0, parseFloat(minSpend.replace(",", ".")) || 0);
  const selectedTerms = useMemo(() => Object.values(selected), [selected]);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return rows
      .filter((r) => {
        if (onlyCandidates) {
          const v = suggestion(r, threshold);
          if (v.cls !== "red" && v.cls !== "yellow") return false;
        }
        if (needle === "") return true;
        return (
          r.term.toLowerCase().includes(needle) ||
          r.campaignName.toLowerCase().includes(needle) ||
          r.adGroupName.toLowerCase().includes(needle)
        );
      })
      .sort((a, b) => b.spend - a.spend);
  }, [rows, onlyCandidates, threshold, filter]);

  const candidates = useMemo(
    () => rows.filter((r) => suggestion(r, threshold).cls === "red"),
    [rows, threshold]
  );
  const wasted = candidates.reduce((sum, r) => sum + r.spend, 0);

  function toggle(row: TermRow) {
    setSelected((current) => {
      const next = { ...current };
      if (next[row.key]) delete next[row.key];
      else next[row.key] = row;
      return next;
    });
  }

  function selectVisible() {
    setSelected((current) => {
      const next = { ...current };
      for (const row of visible) next[row.key] = row;
      return next;
    });
  }

  function clearSelection() {
    setSelected({});
  }

  async function pushNegatives() {
    const terms = Object.values(selected);
    if (terms.length === 0) return;

    const perCampaign = new Map<string, TermRow[]>();
    for (const term of terms) {
      const list = perCampaign.get(term.campaignId) ?? [];
      list.push(term);
      perCampaign.set(term.campaignId, list);
    }

    const summary = Array.from(perCampaign.values())
      .map((list) => `• ${list.length} in "${list[0].campaignName}"`)
      .join("\n");
    if (!window.confirm(`${terms.length} negative keywords als ${matchType} toevoegen?\n\n${summary}`)) return;

    setBusy(true);
    setError(null);
    setNotice(null);
    const failures: string[] = [];
    let pushed = 0;

    for (const [campaignId, list] of perCampaign) {
      try {
        await windsorAction("google_ads", accounts.google_ads, "push_negative_keywords", {
          level: "campaign",
          campaign_id: campaignId,
          keywords: list.map((term) => ({ text: term.term, match_type: matchType })),
        });
        pushed += list.length;
      } catch (e) {
        failures.push(`${list[0].campaignName}: ${String(e)}`);
      }
    }

    if (pushed > 0) {
      setNotice(`${pushed} negative keyword${pushed === 1 ? "" : "s"} toegevoegd in Google Ads.`);
      setSelected({});
      setReloadKey((key) => key + 1);
    }
    if (failures.length > 0) setError(failures.join("\n"));
    setBusy(false);
  }

  async function copySelection() {
    const text = Object.values(selected).map((r) => r.term).join("\n");
    if (text === "") return;
    try {
      await navigator.clipboard.writeText(text);
      setNotice(`${Object.keys(selected).length} zoektermen gekopieerd — plak ze in Google Ads onder Negative keywords.`);
    } catch {
      setError("Kopiëren naar het klembord lukte niet.");
    }
  }

  return (
    <div>
      <h1>Zoektermen (Google Ads)</h1>
      <p className="subtitle">
        Zoektermen waarop je advertenties zijn vertoond — laatste {days} dagen. Kandidaten voor negative keywords
        staan bovenaan.
      </p>

      {error && <div className="error-box" style={{ whiteSpace: "pre-wrap" }}>{error}</div>}
      {notice && (
        <div className="card" style={{ borderColor: "var(--accent-2)", marginBottom: 16 }}>
          <span style={{ color: "var(--accent-2)" }}>{notice}</span>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="term-summary">
          <div>
            <div className="stat-value">{fmt(rows.reduce((s, r) => s + r.spend, 0), 2)}</div>
            <div className="stat-label">Kosten in beeld (€)</div>
          </div>
          <div>
            <div className="stat-value" style={{ color: "var(--danger)" }}>{fmt(wasted, 2)}</div>
            <div className="stat-label">Zonder conversie (€)</div>
          </div>
          <div>
            <div className="stat-value">{candidates.length}</div>
            <div className="stat-label">Negative-kandidaten</div>
          </div>
          <div>
            <div className="stat-value">{rows.length}</div>
            <div className="stat-label">Zoektermen</div>
          </div>
        </div>
      </div>

      <div className="toolbar">
        <div className="range-switch">
          {RANGES.map((value) => (
            <button
              key={value}
              className={`range-option${days === value ? " active" : ""}`}
              aria-pressed={days === value}
              onClick={() => setDays(value)}
            >
              {value}d
            </button>
          ))}
        </div>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter op zoekterm of campagne"
          style={{ minWidth: 240 }}
        />
        <label className="field" style={{ margin: 0, display: "flex", alignItems: "center", gap: 6 }}>
          Min. kosten (€)
          <input
            type="text"
            value={minSpend}
            onChange={(e) => setMinSpend(e.target.value)}
            style={{ width: 70 }}
          />
        </label>
        <label className="field" style={{ margin: 0, display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={onlyCandidates}
            onChange={(e) => setOnlyCandidates(e.target.checked)}
          />
          Alleen kandidaten
        </label>
        <div className="grow" />
        <button className="ghost" onClick={selectVisible} disabled={visible.length === 0}>
          Selecteer zichtbaar
        </button>
        <button className="ghost" onClick={() => setReloadKey((k) => k + 1)} disabled={loading}>
          {loading ? "Vernieuwen…" : "↻ Vernieuwen"}
        </button>
      </div>

      {loading ? (
        <div className="loading">Zoektermen laden…</div>
      ) : (
        <div className="card">
          <table className="data">
            <thead>
              <tr>
                <th style={{ width: 28 }} />
                <th>Zoekterm</th>
                <th>Campagne</th>
                <th className="num">Klikken</th>
                <th className="num">Impr.</th>
                <th className="num">Kosten</th>
                <th className="num">Conv.</th>
                <th className="num">CTR</th>
                <th>Beoordeling</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const verdict = suggestion(row, threshold);
                return (
                  <tr key={row.key}>
                    <td>
                      <input
                        className="term-check"
                        type="checkbox"
                        checked={Boolean(selected[row.key])}
                        onChange={() => toggle(row)}
                        aria-label={`Selecteer ${row.term}`}
                      />
                    </td>
                    <td style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis" }} title={row.term}>
                      {row.term}
                    </td>
                    <td>
                      {row.campaignName}
                      {row.adGroupName && <span className="term-campaign">{row.adGroupName}</span>}
                    </td>
                    <td className="num">{fmt(row.clicks, 0)}</td>
                    <td className="num">{fmt(row.impressions, 0)}</td>
                    <td className="num">{fmt(row.spend, 2)}</td>
                    <td className="num">{fmt(row.conversions, 1)}</td>
                    <td className="num">{fmt(ctr(row), 1)}%</td>
                    <td>
                      <span className={`badge ${verdict.cls}`} title={verdict.why}>
                        {verdict.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {visible.length === 0 && (
            <p className="hint" style={{ padding: 12 }}>
              {rows.length === 0
                ? "Geen zoektermdata gevonden. Controleer of het Google Ads-account zoektermdata doorgeeft."
                : "Geen zoektermen die aan het filter voldoen."}
            </p>
          )}
        </div>
      )}

      {selectedTerms.length > 0 && (
        <div className="negative-bar">
          <strong>{selectedTerms.length} geselecteerd</strong>
          <label className="field" style={{ margin: 0, display: "flex", alignItems: "center", gap: 6 }}>
            Matchtype
            <select value={matchType} onChange={(e) => setMatchType(e.target.value as MatchType)}>
              <option value="PHRASE">Phrase</option>
              <option value="BROAD">Broad</option>
              <option value="EXACT">Exact</option>
            </select>
          </label>
          <span className="hint">
            {fmt(selectedTerms.reduce((s, r) => s + r.spend, 0), 2)} aan kosten in de selectie
          </span>
          <div className="grow" />
          <button className="ghost" onClick={clearSelection}>Wissen</button>
          <button className="ghost" onClick={copySelection}>Kopiëren</button>
          <button className="primary" onClick={pushNegatives} disabled={busy}>
            {busy ? "Toevoegen…" : "Negative keywords toevoegen"}
          </button>
        </div>
      )}

      <p className="hint" style={{ marginTop: 12 }}>
        Een kandidaat is een zoekterm met minimaal €{fmt(threshold, 2)} kosten en nul conversies. Toevoegen gebeurt per
        campagne, als negative keyword op campagneniveau; bestaande negatives worden door Google overgeslagen.
      </p>
    </div>
  );
}
