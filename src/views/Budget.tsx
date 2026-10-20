import React, { useEffect, useMemo, useState } from "react";
import { windsorQuery, num, fmt, Row } from "../lib/api";
import { exportPdf } from "../lib/pdf";

interface Props { accounts: Record<string, string>; }

interface BudgetRow {
  key: string;
  campaignId: string;
  name: string;
  status: string;
  dailyBudget: number;
  budgetType: string;
  spend: number;
  clicks: number;
  conversions: number;
}

/**
 * Windsor levert het budget als NUMERIC. Afhankelijk van het account komt het in
 * euro's of in micros (1.000.000 micros = 1 euro). Een dagbudget boven de ton is
 * in de praktijk altijd micros.
 */
function budgetAmount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value > 100000 ? value / 1_000_000 : value;
}

function monthInfo() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const day = Math.min(Math.max(now.getDate(), 1), daysInMonth);
  const label = now.toLocaleDateString("nl-NL", { month: "long", year: "numeric" });
  return { daysInMonth, day, daysLeft: daysInMonth - day, label };
}

type Pace = { label: string; cls: string; ratio: number; delta: number };

function pacing(row: BudgetRow, day: number): Pace {
  const expected = row.dailyBudget * day;
  if (expected <= 0) return { label: "Geen budget", cls: "blue", ratio: 0, delta: 0 };
  const ratio = row.spend / expected;
  const delta = row.spend - expected;
  if (ratio > 1.1) return { label: "Over budget", cls: "red", ratio, delta };
  if (ratio < 0.9) return { label: "Onder budget", cls: "yellow", ratio, delta };
  return { label: "Op schema", cls: "green", ratio, delta };
}

export default function Budget({ accounts }: Props) {
  const [rows, setRows] = useState<BudgetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfMsg, setPdfMsg] = useState<string | null>(null);
  const [onlyActive, setOnlyActive] = useState(true);
  const month = useMemo(monthInfo, [reloadKey]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      const now = new Date();
      const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const iso = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      try {
        const data = await windsorQuery({
          connector: "google_ads",
          account: accounts.google_ads,
          fields: [
            "campaign_id", "campaign_name", "status",
            "campaign_budget", "campaign_budget_type",
            "spend", "clicks", "conversions",
          ],
          date_from: iso(firstOfMonth),
          group_by: ["campaign_id", "campaign_name", "status", "campaign_budget", "campaign_budget_type"],
          limit: 500,
          options: { include_inactive: "true" },
        });
        if (cancelled) return;
        setRows(
          data
            .map((r: Row) => ({
              key: String(r.campaign_id ?? r.campaign_name ?? ""),
              campaignId: String(r.campaign_id ?? ""),
              name: String(r.campaign_name ?? "Onbekende campagne"),
              status: String(r.status ?? "").toUpperCase(),
              dailyBudget: budgetAmount(num(r.campaign_budget)),
              budgetType: String(r.campaign_budget_type ?? "DAILY").toUpperCase(),
              spend: num(r.spend),
              clicks: num(r.clicks),
              conversions: num(r.conversions),
            }))
            .filter((r) => r.campaignId !== "")
        );
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [accounts, reloadKey]);

  const visible = useMemo(() => {
    const list = onlyActive ? rows.filter((r) => r.status !== "PAUSED" && r.status !== "REMOVED") : rows;
    return list.sort((a, b) => pacing(b, month.day).delta - pacing(a, month.day).delta);
  }, [rows, onlyActive, month.day]);

  const totals = visible.reduce(
    (acc, row) => {
      const pace = pacing(row, month.day);
      acc.spend += row.spend;
      acc.dailyBudget += row.dailyBudget;
      acc.projected += month.day > 0 ? (row.spend / month.day) * month.daysInMonth : 0;
      acc.monthBudget += row.dailyBudget * month.daysInMonth;
      if (pace.cls === "red") acc.over += 1;
      if (pace.cls === "yellow") acc.under += 1;
      return acc;
    },
    { spend: 0, dailyBudget: 0, projected: 0, monthBudget: 0, over: 0, under: 0 }
  );

  async function exportReport() {
    setPdfBusy(true);
    setPdfMsg(null);
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      const path = await exportPdf({
        title: "Budget en pacing",
        subtitle: `${month.label} — dag ${month.day} van ${month.daysInMonth}`,
        kpis: [
          { label: "Besteed deze maand", value: `€ ${fmt(totals.spend, 0)}` },
          { label: "Dagbudget samen", value: `€ ${fmt(totals.dailyBudget, 0)}` },
          { label: "Verwachte maandkosten", value: `€ ${fmt(totals.projected, 0)}` },
          { label: "Over budget", value: String(totals.over) },
          { label: "Onder budget", value: String(totals.under) },
        ],
        sections: [
          {
            title: "Pacing per campagne",
            head: ["Campagne", "Dagbudget", "Besteed", "Verwacht nu", "Projectie", "Pacing", "Status"],
            rows: visible.map((row) => {
              const pace = pacing(row, month.day);
              return [
                row.name,
                `€ ${fmt(row.dailyBudget, 2)}`,
                `€ ${fmt(row.spend, 2)}`,
                `€ ${fmt(row.dailyBudget * month.day, 2)}`,
                `€ ${fmt(month.day > 0 ? (row.spend / month.day) * month.daysInMonth : 0, 2)}`,
                `${fmt(pace.ratio * 100, 0)}%`,
                pace.label,
              ];
            }),
            note: "Verwacht nu = dagbudget × verstreken dagen. Projectie rekent het huidige tempo door naar de hele maand.",
          },
        ],
        filename: `adlytica-budget-${stamp}.pdf`,
      });
      setPdfMsg(`Opgeslagen: ${path}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setPdfBusy(false);
    }
  }

  return (
    <div>
      <h1>Budget</h1>
      <p className="subtitle">
        Pacing voor {month.label} — dag {month.day} van {month.daysInMonth}, nog {month.daysLeft} dagen te gaan.
      </p>

      {error && <div className="error-box">{error}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="term-summary">
          <div>
            <div className="stat-value">{fmt(totals.spend, 0)}</div>
            <div className="stat-label">Besteed deze maand (€)</div>
          </div>
          <div>
            <div className="stat-value">{fmt(totals.dailyBudget, 0)}</div>
            <div className="stat-label">Dagbudget samen (€)</div>
          </div>
          <div>
            <div className="stat-value">{fmt(totals.projected, 0)}</div>
            <div className="stat-label">Verwachte maandkosten (€)</div>
          </div>
          <div>
            <div className="stat-value" style={{ color: "var(--danger)" }}>{totals.over}</div>
            <div className="stat-label">Campagnes over budget</div>
          </div>
          <div>
            <div className="stat-value" style={{ color: "var(--warn)" }}>{totals.under}</div>
            <div className="stat-label">Campagnes onder budget</div>
          </div>
        </div>
      </div>

      <div className="toolbar">
        <label className="field" style={{ margin: 0, display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} />
          Alleen actieve campagnes
        </label>
        <div className="grow" />
        <button className="ghost" onClick={() => setReloadKey((k) => k + 1)} disabled={loading}>
          {loading ? "Vernieuwen…" : "↻ Vernieuwen"}
        </button>
        <button className="ghost" onClick={exportReport} disabled={pdfBusy || visible.length === 0}>
          {pdfBusy ? "PDF…" : "⬇ PDF"}
        </button>
      </div>
      {pdfMsg && <p className="hint" style={{ marginTop: 8 }}>{pdfMsg}</p>}

      {loading ? (
        <div className="loading">Budgetten laden…</div>
      ) : (
        <div className="card">
          <table className="data">
            <thead>
              <tr>
                <th>Campagne</th>
                <th className="num">Dagbudget</th>
                <th className="num">Besteed</th>
                <th className="num">Verwacht nu</th>
                <th className="num">Projectie</th>
                <th style={{ width: 120 }}>Pacing</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const pace = pacing(row, month.day);
                const expected = row.dailyBudget * month.day;
                const projected = month.day > 0 ? (row.spend / month.day) * month.daysInMonth : 0;
                const barWidth = Math.min(100, (pace.ratio / 1.5) * 100);
                return (
                  <tr key={row.key}>
                    <td style={{ maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis" }} title={row.name}>
                      {row.name}
                      {row.status && row.status !== "ENABLED" && <span className="term-campaign">{row.status.toLowerCase()}</span>}
                    </td>
                    <td className="num">{fmt(row.dailyBudget, 2)}</td>
                    <td className="num">{fmt(row.spend, 2)}</td>
                    <td className="num" title={`Dagbudget × ${month.day} dagen`}>{fmt(expected, 2)}</td>
                    <td className="num">{fmt(projected, 2)}</td>
                    <td>
                      <div className="pace-track" title={`${fmt(pace.ratio * 100, 0)}% van het budget tot nu toe`}>
                        <div
                          className={`pace-fill ${pace.cls}`}
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${pace.cls}`} title={`${pace.delta >= 0 ? "+" : "−"}€${fmt(Math.abs(pace.delta), 2)} t.o.v. schema`}>
                        {pace.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {visible.length === 0 && (
            <p className="hint" style={{ padding: 12 }}>
              Geen campagnes met een dagbudget gevonden voor deze maand.
            </p>
          )}
        </div>
      )}

      <p className="hint" style={{ marginTop: 12 }}>
        "Verwacht nu" is het dagbudget maal het aantal verstreken dagen; de balk toont hoeveel daarvan werkelijk besteed
        is (vol = 100%, einde = 150%). De projectie rekent het huidige tempo door naar de hele maand.
      </p>
    </div>
  );
}
