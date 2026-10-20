import React, { useState } from "react";
import { runPageSpeed, PageSpeedResult } from "../lib/api";

function scoreColor(score: number): string {
  if (score >= 90) return "var(--accent-2)";
  if (score >= 50) return "var(--warn)";
  return "var(--danger)";
}

/** Lighthouse-omschrijvingen bevatten markdown-links; die halen we eruit. */
function plain(text: string): string {
  return text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\s+/g, " ").trim();
}

function Gauge({ label, score }: { label: string; score: number }) {
  return (
    <div className="card speed-gauge">
      <div className="audit-ring" style={{ ["--ring-color" as string]: scoreColor(score) }}>
        <span>{score}</span>
      </div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

export default function PageSpeed() {
  const [url, setUrl] = useState(() => localStorage.getItem("adlytica.pagespeed.url") ?? "");
  const [strategy, setStrategy] = useState<"mobile" | "desktop">(
    () => (localStorage.getItem("adlytica.pagespeed.strategy") === "desktop" ? "desktop" : "mobile")
  );
  const [result, setResult] = useState<PageSpeedResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function measure() {
    if (busy || url.trim() === "") return;
    setBusy(true);
    setError(null);
    localStorage.setItem("adlytica.pagespeed.url", url.trim());
    localStorage.setItem("adlytica.pagespeed.strategy", strategy);
    try {
      setResult(await runPageSpeed(url.trim(), strategy));
    } catch (e) {
      setResult(null);
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1>Snelheid</h1>
      <p className="subtitle">
        Meet een pagina met PageSpeed Insights: Lighthouse-scores, kerncijfers en de grootste
        verbeterpunten. Eén meting duurt tien tot dertig seconden.
      </p>

      <div className="toolbar">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void measure();
          }}
          placeholder="white-vision.nl/dj-bruiloft/"
          className="grow"
          style={{ minWidth: 260 }}
        />
        <div className="range-switch" role="group" aria-label="Apparaat">
          {(["mobile", "desktop"] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={strategy === value ? "range-option active" : "range-option"}
              onClick={() => setStrategy(value)}
              aria-pressed={strategy === value}
            >
              {value === "mobile" ? "Mobiel" : "Desktop"}
            </button>
          ))}
        </div>
        <button className="primary" onClick={measure} disabled={busy || url.trim() === ""}>
          {busy ? "Meten…" : "Meten"}
        </button>
      </div>

      {busy && <p className="hint">Google meet de pagina. Dit duurt meestal 10–30 seconden.</p>}
      {error && (
        <p className="hint" style={{ color: "var(--danger)" }}>
          {error}
          {/key/i.test(error) ? " Vul een key in bij Instellingen → PageSpeed." : ""}
        </p>
      )}

      {!result && !busy && !error && (
        <div className="card">
          <h3>Wat je krijgt</h3>
          <ul className="audit-list">
            <li><strong>Scores</strong> — performance, toegankelijkheid, best practices en SEO (0–100).</li>
            <li><strong>Kerncijfers</strong> — eerste weergave, grootste element, blokkerende tijd, layoutverschuiving, snelheidsindex en serverreactie.</li>
            <li><strong>Verbeterpunten</strong> — de audits waar de meeste tijd te winnen is, met de geschatte winst.</li>
          </ul>
          <p className="hint" style={{ marginBottom: 0 }}>
            PageSpeed Insights is gratis; je hebt alleen een Google API-key nodig (quotum ruim voldoende
            voor dagelijks gebruik).
          </p>
        </div>
      )}

      {result && (
        <>
          <div className="speed-gauges">
            <Gauge label="Performance" score={result.scores.performance} />
            <Gauge label="Toegankelijkheid" score={result.scores.accessibility} />
            <Gauge label="Best practices" score={result.scores.best_practices} />
            <Gauge label="SEO" score={result.scores.seo} />
          </div>

          <p className="hint">
            {result.url} · {result.strategy === "mobile" ? "mobiel" : "desktop"} ·{" "}
            {new Date(result.fetched_at).toLocaleString("nl-NL", { dateStyle: "short", timeStyle: "short" })}
          </p>

          <div className="speed-grid">
            <div className="card">
              <h3>Kerncijfers</h3>
              {result.metrics.length === 0 && <p className="hint">Geen metingen ontvangen.</p>}
              {result.metrics.map((metric) => (
                <div className="speed-metric" key={metric.key}>
                  <span className="speed-metric-label">{metric.label}</span>
                  <span className="speed-metric-value">{metric.value}</span>
                  <span className="speed-metric-bar">
                    <span style={{ width: `${metric.score}%`, background: scoreColor(metric.score) }} />
                  </span>
                </div>
              ))}
            </div>

            <div className="card">
              <h3>Verbeterpunten</h3>
              {result.opportunities.length === 0 && (
                <p className="hint">Geen grote verbeterpunten gevonden.</p>
              )}
              <ol className="speed-opportunities">
                {result.opportunities.map((item, index) => (
                  <li key={`${item.title}-${index}`}>
                    <div className="speed-opportunity-head">
                      <span>{plain(item.title)}</span>
                      <span className="badge yellow">
                        {item.savings_ms >= 1000
                          ? `${(item.savings_ms / 1000).toFixed(1)} s`
                          : `${item.savings_ms} ms`}
                      </span>
                    </div>
                    {item.description && (
                      <p className="hint" style={{ margin: "4px 0 0" }}>{plain(item.description)}</p>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
