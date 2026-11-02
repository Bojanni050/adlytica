import React, { useEffect, useMemo, useState } from "react";
import {
  runAudit, analyticsQuery, AuditPage, AuditResult, AiCrawlerResult, Row,
} from "../lib/api";
import { exportPdf, loadPdfBrand } from "../lib/pdf";
import PdfResult from "../components/PdfResult";
import { useDateRange } from "../lib/dateRange";

type Filter = "all" | "error" | "warning" | "clean";

const LIMITS = [25, 50, 100, 250];

interface PageStats {
  clicks: number;
  impressions: number;
}

function normalizeUrl(value: string): string {
  return value
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "")
    .replace(/#.*$/, "")
    .toLowerCase();
}

function pathParts(page: AuditPage): string[] {
  try {
    return new URL(page.url).pathname.split("/").filter(Boolean);
  } catch {
    return [];
  }
}

function shortPath(page: AuditPage): string {
  try {
    const parsed = new URL(page.url);
    const path = `${parsed.pathname}${parsed.search}`;
    return path === "/" ? "/" : path;
  } catch {
    return page.url;
  }
}

function statusClass(status: number): string {
  if (status >= 400) return "badge red";
  if (status >= 300) return "badge yellow";
  return "badge green";
}

function healthColor(score: number): string {
  if (score >= 80) return "var(--accent-2)";
  if (score >= 60) return "var(--warn)";
  return "var(--danger)";
}

/** Zelfde samenvatting als de backend maakt, maar dan op de al geserialiseerde velden. */
function botSummary(bot: AiCrawlerResult): string {
  if (bot.robots_blocked) return `${bot.bot} is geblokkeerd in robots.txt.`;
  if (bot.blocked > 0) return `kreeg ${bot.blocked} van ${bot.sampled} pagina's niet binnen`;
  if (bot.challenged > 0) return "stuitte op een CDN-challenge";
  if (bot.thinner > 0 || bot.js_only > 0) return "krijgt minder inhoud dan een gewone bezoeker";
  if (bot.different_title > 0) return "ziet een andere titel";
  return "ziet dezelfde pagina's.";
}

function impactLabel(impact: string): string {
  if (impact === "high") return "hoge impact";
  if (impact === "medium") return "gemiddelde impact";
  return "lage impact";
}

function impactClass(impact: string): string {
  if (impact === "high") return "badge red";
  if (impact === "medium") return "badge yellow";
  return "badge blue";
}

function formatDate(stamp: string): string {
  const date = new Date(stamp);
  if (Number.isNaN(date.getTime())) return stamp;
  return date.toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
}

function labels(page: AuditPage): string[] {
  const out: string[] = [];
  if (page.status >= 400) out.push(String(page.status));
  if (page.noindex) out.push("noindex");
  if (page.canonical) {
    const target = normalizeUrl(page.canonical);
    if (target !== normalizeUrl(page.url)) out.push("canonicalized");
  }
  if (page.inbound === 0) out.push("orphan");
  return out;
}

export default function Audit({ accounts }: { accounts: Record<string, string> }) {
  const { from, to } = useDateRange();
  const [url, setUrl] = useState(() => localStorage.getItem("adlytica.audit.url") ?? "");
  const [limit, setLimit] = useState(() => Number(localStorage.getItem("adlytica.audit.limit") ?? 100));
  const [result, setResult] = useState<AuditResult | null>(null);
  const [stats, setStats] = useState<Record<string, PageStats>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [focus, setFocus] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfMsg, setPdfMsg] = useState<string | null>(null);
  const [pdfPath, setPdfPath] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem("adlytica.audit.limit", String(limit));
  }, [limit]);

  async function loadStats(base: string): Promise<Record<string, PageStats>> {
    if (!accounts.searchconsole) return {};
    try {
      const rows: Row[] = await analyticsQuery({
        connector: "searchconsole",
        account: accounts.searchconsole,
        fields: ["page", "clicks", "impressions"],
        date_from: from,
        date_to: to,
        group_by: ["page"],
        limit: 5000,
      });
      const map: Record<string, PageStats> = {};
      for (const row of rows) {
        const page = String(row.page ?? "");
        if (!page) continue;
        const key = normalizeUrl(page);
        const clicks = Number(row.clicks ?? 0);
        const impressions = Number(row.impressions ?? 0);
        const current = map[key];
        map[key] = {
          clicks: (current?.clicks ?? 0) + clicks,
          impressions: (current?.impressions ?? 0) + impressions,
        };
      }
      return map;
    } catch {
      return {};
    }
  }

  async function start() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setPdfMsg(null);
    localStorage.setItem("adlytica.audit.url", url.trim());
    try {
      const audit = await runAudit(url.trim(), limit);
      setResult(audit);
      setOpen(null);
      setFilter("all");
      setFocus(null);
      setStats(await loadStats(audit.base));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const totals = useMemo(() => {
    const pages = result?.pages ?? [];
    return {
      pages: pages.length,
      errors: pages.reduce((sum, p) => sum + p.errors, 0),
      warnings: pages.reduce((sum, p) => sum + p.warnings, 0),
      noMeta: pages.filter((p) => p.meta_len === 0).length,
      noH1: pages.filter((p) => p.h1_count === 0).length,
      orphans: pages.filter((p) => p.inbound === 0).length,
    };
  }, [result]);

  const sortedTasks = useMemo(() => {
    const rank = (impact: string) => (impact === "high" ? 0 : impact === "medium" ? 1 : 2);
    return [...(result?.tasks ?? [])].sort(
      (a, b) => rank(a.impact) - rank(b.impact) || b.count - a.count
    );
  }, [result]);

  const sortedPages = useMemo(() => {
    const pages = result?.pages ?? [];
    return [...pages]
      .map((page) => ({ page, parts: pathParts(page) }))
      .sort((a, b) => a.page.url.localeCompare(b.page.url));
  }, [result]);

  const counts = useMemo(() => {
    const pages = result?.pages ?? [];
    return {
      all: pages.length,
      error: pages.filter((p) => p.errors > 0).length,
      warning: pages.filter((p) => p.warnings > 0).length,
      clean: pages.filter((p) => p.issues.length === 0).length,
    };
  }, [result]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return sortedPages.filter(({ page }) => {
      if (focus && !page.issues.some((issue) => issue.code === focus)) return false;
      if (filter === "error" && page.errors === 0) return false;
      if (filter === "warning" && page.warnings === 0) return false;
      if (filter === "clean" && page.issues.length > 0) return false;
      if (needle === "") return true;
      return page.url.toLowerCase().includes(needle) || page.title.toLowerCase().includes(needle);
    });
  }, [sortedPages, focus, filter, search]);

  async function exportReport() {
    if (!result) return;
    setPdfBusy(true);
    setPdfMsg(null);
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      const host = (() => {
        try {
          return new URL(result.base).hostname;
        } catch {
          return "site";
        }
      })();
      const delta = result.previous ? result.score - result.previous.score : null;
      const pages = result.pages.map((page) => [
        shortPath(page),
        page.status,
        `${page.score}`,
        stats[normalizeUrl(page.url)]?.clicks ?? "—",
        page.issues.length === 0 ? "in orde" : page.issues.map((i) => i.message).join("; "),
      ]);
      const path = await exportPdf({
        title: "Technische audit",
        subtitle: `${host} · ${result.crawled} pagina's · ${new Date().toLocaleDateString("nl-NL")}`,
        brand: await loadPdfBrand(),
        kpis: [
          { label: "Health score", value: `${result.score}${delta === null ? "" : ` (${delta >= 0 ? "+" : ""}${delta})`}` },
          { label: "Fouten", value: String(totals.errors) },
          { label: "Waarschuwingen", value: String(totals.warnings) },
          { label: "Zonder meta", value: String(totals.noMeta) },
          { label: "Zonder H1", value: String(totals.noH1) },
          { label: "Orphans", value: String(totals.orphans) },
        ],
        sections: [
          {
            title: "Taken",
            head: ["Taak", "Impact", "Pagina's"],
            rows: [...result.tasks]
              .sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.impact] - { high: 0, medium: 1, low: 2 }[b.impact]) || b.count - a.count)
              .map((task) => [task.label, impactLabel(task.impact), task.count]),
          },
          {
            title: "Site-brede controles",
            head: ["Controle", "Status", "Toelichting"],
            rows: result.checks.map((check) => [check.label, check.ok ? "in orde" : "actie", check.detail]),
          },
          {
            title: "AI-crawlers",
            head: ["Bot", "robots.txt", "Opgehaald", "Wat hij ziet"],
            rows: result.ai_crawlers.map((bot) => [
              bot.bot,
              bot.robots_blocked ? "geblokkeerd" : "toegestaan",
              `${bot.sampled - bot.blocked}/${bot.sampled}`,
              botSummary(bot),
            ]),
          },
          {
            title: "Sitemap",
            head: ["Controle", "Aantal", "Voorbeelden"],
            rows: [
              ["URL's in de sitemap", result.sitemap.found ? result.sitemap.urls : 0, result.sitemap.found ? "" : "geen sitemap gevonden"],
              ["Niet bereikbaar", result.sitemap.not_found.length, result.sitemap.not_found.slice(0, 5).join(", ")],
              ["Met een redirect", result.sitemap.redirected.length, result.sitemap.redirected.slice(0, 5).join(", ")],
              ["Niet gecrawld", result.sitemap.missing_from_crawl_total, result.sitemap.missing_from_crawl.slice(0, 5).join(", ")],
              ["Niet in de sitemap", result.sitemap.not_in_sitemap.length, result.sitemap.not_in_sitemap.slice(0, 5).join(", ")],
            ],
          },
          {
            title: "Crawl-budget",
            head: ["Patroon", "Wat het is", "Keer gezien"],
            rows: result.crawl_budget.traps.length > 0
              ? result.crawl_budget.traps.map((trap) => [trap.pattern, trap.label, trap.count])
              : [["—", "Geen crawl-traps gevonden", result.crawl_budget.with_params]],
            note: `${result.crawl_budget.with_params} van ${result.crawl_budget.total} URL's heeft queryparameters (${result.crawl_budget.param_share_pct}%).`,
          },
          {
            title: "Aanbevolen robots.txt",
            head: ["Regel"],
            rows: result.crawl_budget.advice.length > 0
              ? result.crawl_budget.advice.map((line) => [line])
              : [["Geen aanbevelingen — het crawl-budget is in orde."]],
          },
          {
            title: "Pagina's",
            head: ["Pagina", "Status", "Health", "Klikken", "Bevindingen"],
            rows: pages.slice(0, 80),
            note: pages.length > 80 ? `${pages.length - 80} pagina's staan niet in dit rapport.` : undefined,
          },
        ],
        filename: `adlytica-audit-${host}-${stamp}.pdf`,
      });
      setPdfPath(path);
      setPdfMsg(`Opgeslagen: ${path}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setPdfBusy(false);
    }
  }

  const delta = result?.previous ? result.score - result.previous.score : null;
  const hasStats = Object.keys(stats).length > 0;

  return (
    <div>
      <h1>Technische audit</h1>
      <p className="subtitle">
        Crawlt je eigen site en controleert titels, meta-omschrijvingen, koppen, canonical,
        indexeerbaarheid, interne links, alt-teksten en structured data. Alles gebeurt lokaal.
      </p>

      <div className="toolbar">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void start();
          }}
          placeholder="white-vision.nl"
          className="grow"
          style={{ minWidth: 240 }}
        />
        <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
          {LIMITS.map((value) => (
            <option key={value} value={value}>
              max. {value} pagina's
            </option>
          ))}
        </select>
        <button className="primary" onClick={start} disabled={busy || url.trim() === ""}>
          {busy ? "Bezig…" : "Start audit"}
        </button>
        <button className="ghost" onClick={exportReport} disabled={!result || pdfBusy}>
          {pdfBusy ? "PDF…" : "⬇ PDF"}
        </button>
      </div>

      {busy && (
        <p className="hint">
          De crawler haalt de pagina's op. Bij 100 pagina's duurt dit ongeveer een halve minuut.
        </p>
      )}
      <PdfResult path={pdfPath} message={pdfMsg} onError={setError} />
      {error && <p className="hint" style={{ color: "var(--danger)" }}>{error}</p>}

      {!result && !busy && (
        <div className="card">
          <h3>Wat er gecontroleerd wordt</h3>
          <ul className="audit-list">
            <li><strong>Fouten</strong> — status 4xx/5xx, ontbrekende title of H1, kapotte links.</li>
            <li><strong>Waarschuwingen</strong> — title- en meta-lengte, meerdere H1's, canonical, noindex, dunne tekst, alt-teksten, dubbele titles en H1's, vergelijkbare inhoud, OpenGraph, trage respons, structured data.</li>
            <li><strong>Links</strong> — pagina's zonder interne link, interne links naar een redirect en kapotte interne of externe links.</li>
            <li><strong>Site-breed</strong> — https, robots.txt en of er een sitemap is (die bepaalt welke URL's worden gecontroleerd).</li>
          </ul>
        </div>
      )}

      {result && (
        <>
          <div className="audit-score-row">
            <div className="card audit-score-card">
              <div className="audit-ring" style={{ ["--ring-color" as string]: healthColor(result.score) }}>
                <span>{result.score}</span>
              </div>
              <div>
                <div className="stat-label">health score</div>
                {delta !== null && result.previous ? (
                  <div className={`stat-delta ${delta >= 0 ? "up" : "down"}`}>
                    {delta >= 0 ? "+" : ""}{delta} t.o.v. {formatDate(result.previous.at)} ({result.previous.score})
                  </div>
                ) : (
                  <div className="stat-delta">eerste meting van deze site</div>
                )}
              </div>
            </div>
            <div className="audit-kpis">
              <div className="card">
                <div className="stat-value">{totals.pages}</div>
                <div className="stat-label">pagina's</div>
              </div>
              <div className="card">
                <div className="stat-value" style={{ color: totals.errors > 0 ? "var(--danger)" : undefined }}>
                  {totals.errors}
                </div>
                <div className="stat-label">fouten</div>
              </div>
              <div className="card">
                <div className="stat-value" style={{ color: totals.warnings > 0 ? "var(--warn)" : undefined }}>
                  {totals.warnings}
                </div>
                <div className="stat-label">waarschuwingen</div>
              </div>
              <div className="card">
                <div className="stat-value">{totals.noMeta}</div>
                <div className="stat-label">zonder meta</div>
              </div>
              <div className="card">
                <div className="stat-value">{totals.orphans}</div>
                <div className="stat-label">orphans</div>
              </div>
            </div>
          </div>

          <div className="audit-checks">
            {result.checks.map((check) => (
              <span key={check.label} className={check.ok ? "badge green" : "badge yellow"} title={check.detail}>
                {check.ok ? "✓" : "!"} {check.label}
              </span>
            ))}
            <span className="hint">
              {(result.duration_ms / 1000).toFixed(1)} s · {result.sitemap_urls} URL's in de sitemap
              {result.failed > 0 ? ` · ${result.failed} niet opgehaald` : ""}
              {result.truncated ? " · crawl afgekapt op de limiet" : ""}
            </span>
          </div>

          {result.ai_crawlers.length > 0 && (
            <>
              <h3 className="audit-section">AI-crawlers</h3>
              <div className="card">
                <p className="hint" style={{ marginTop: 0 }}>
                  Dezelfde pagina's, opgevraagd met de user-agent van elke bot. Zo zie je of
                  ChatGPT, Perplexity en OpenAI's zoekbot je site net zo goed lezen als Google.
                </p>
                <table className="data">
                  <thead>
                    <tr>
                      <th>Bot</th>
                      <th>robots.txt</th>
                      <th>Opgehaald</th>
                      <th>Wat hij ziet</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.ai_crawlers.map((bot) => (
                      <tr key={bot.bot}>
                        <td>{bot.bot}</td>
                        <td>
                          {bot.robots_blocked
                            ? <span className="badge red">geblokkeerd</span>
                            : <span className="badge green">toegestaan</span>}
                        </td>
                        <td className="num">
                          {bot.sampled - bot.blocked}/{bot.sampled}
                        </td>
                        <td>
                          {bot.robots_blocked || bot.blocked + bot.challenged + bot.different_title + bot.thinner + bot.js_only > 0
                            ? <span className="badge yellow">{botSummary(bot)}</span>
                            : <span className="badge green">{botSummary(bot)}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {result.ai_crawlers.some((bot) => bot.notes.length > 0) && (
                  <ul className="audit-list" style={{ marginTop: 10 }}>
                    {result.ai_crawlers.flatMap((bot) =>
                      bot.notes.map((note, index) => (
                        <li key={`${bot.bot}-${index}`}><strong>{bot.bot}</strong> — {note}</li>
                      ))
                    )}
                  </ul>
                )}
              </div>
            </>
          )}

          <h3 className="audit-section">Sitemap</h3>
          <div className="card">
            {!result.sitemap.found ? (
              <p className="hint" style={{ margin: 0 }}>
                Geen sitemap gevonden. Zonder sitemap moet Google je pagina's via links vinden;
                dat kost meer tijd en laat losse pagina's sneller buiten beeld.
              </p>
            ) : (
              <>
                <p className="hint" style={{ marginTop: 0 }}>
                  {result.sitemap.urls} URL's in de sitemap, vergeleken met wat de crawler vond.
                </p>
                {result.sitemap.not_found.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <strong style={{ color: "var(--danger)" }}>In de sitemap maar niet bereikbaar ({result.sitemap.not_found.length})</strong>
                    <ul className="audit-list">
                      {result.sitemap.not_found.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </div>
                )}
                {result.sitemap.redirected.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <strong style={{ color: "var(--warn)" }}>In de sitemap maar met een redirect ({result.sitemap.redirected.length})</strong>
                    <ul className="audit-list">
                      {result.sitemap.redirected.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </div>
                )}
                {result.sitemap.missing_from_crawl_total > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <strong>In de sitemap maar niet gecrawld ({result.sitemap.missing_from_crawl_total})</strong>
                    <ul className="audit-list">
                      {result.sitemap.missing_from_crawl.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                    {result.sitemap.missing_from_crawl_total > result.sitemap.missing_from_crawl.length && (
                      <p className="hint" style={{ margin: 0 }}>
                        {result.sitemap.missing_from_crawl_total - result.sitemap.missing_from_crawl.length} meer — verhoog de paginalimiet om ze mee te nemen.
                      </p>
                    )}
                  </div>
                )}
                {result.sitemap.not_in_sitemap.length > 0 && (
                  <div>
                    <strong>Gecrawld maar niet in de sitemap ({result.sitemap.not_in_sitemap.length})</strong>
                    <ul className="audit-list">
                      {result.sitemap.not_in_sitemap.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </div>
                )}
                {result.sitemap.not_found.length === 0 &&
                  result.sitemap.redirected.length === 0 &&
                  result.sitemap.missing_from_crawl_total === 0 &&
                  result.sitemap.not_in_sitemap.length === 0 && (
                    <p className="hint" style={{ margin: 0 }}>Sitemap en crawl komen overeen.</p>
                  )}
              </>
            )}
          </div>

          <h3 className="audit-section">Crawl-budget</h3>
          <div className="card">
            <p className="hint" style={{ marginTop: 0 }}>
              {result.crawl_budget.with_params} van {result.crawl_budget.total} URL's
              ({result.crawl_budget.param_share_pct}%) heeft queryparameters. Hoe meer varianten
              van dezelfde pagina, hoe meer crawlbudget er aan dubbele inhoud opgaat.
            </p>
            {result.crawl_budget.traps.length > 0 ? (
              <table className="data">
                <thead>
                  <tr>
                    <th>Patroon</th>
                    <th>Wat het is</th>
                    <th>Keer gezien</th>
                    <th>Voorbeeld</th>
                  </tr>
                </thead>
                <tbody>
                  {result.crawl_budget.traps.map((trap) => (
                    <tr key={trap.pattern}>
                      <td><code>{trap.pattern}</code></td>
                      <td>{trap.label}</td>
                      <td className="num">{trap.count}</td>
                      <td className="hint">{trap.examples[0] ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="hint" style={{ margin: 0 }}>Geen URL-patronen gevonden die op een crawl-trap lijken.</p>
            )}
            {result.crawl_budget.soft_404.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <strong style={{ color: "var(--warn)" }}>Soft-404's</strong>
                <ul className="audit-list">
                  {result.crawl_budget.soft_404.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </div>
            )}
            {result.crawl_budget.advice.length > 0 && (
              <>
                <strong style={{ display: "block", marginTop: 12 }}>Aanbevolen robots.txt-regels</strong>
                <pre
                  style={{
                    background: "var(--panel-2)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    padding: 10,
                    fontSize: 12,
                    overflowX: "auto",
                    margin: "8px 0 0",
                  }}
                >
                  {result.crawl_budget.advice.join("\n")}
                </pre>
              </>
            )}
          </div>

          <h3 className="audit-section">Taken ({sortedTasks.length})</h3>
          <div className="task-list">
            {sortedTasks.length === 0 && <p className="hint">Geen openstaande taken.</p>}
            {sortedTasks.map((task) => (
              <button
                key={task.code}
                type="button"
                className={focus === task.code ? "task-row active" : "task-row"}
                onClick={() => {
                  setFocus(focus === task.code ? null : task.code);
                  setFilter("all");
                }}
              >
                <span className={impactClass(task.impact)}>{impactLabel(task.impact)}</span>
                <span className="task-label">{task.label}</span>
                <span className="task-count">
                  {task.count} {task.count === 1 ? "pagina" : "pagina's"}
                </span>
              </button>
            ))}
          </div>

          <div className="toolbar" style={{ marginTop: 18 }}>
            <div className="range-switch" role="group" aria-label="Filter">
              {([
                ["all", `Alles ${counts.all}`],
                ["error", `Fouten ${counts.error}`],
                ["warning", `Waarschuwingen ${counts.warning}`],
                ["clean", `Schoon ${counts.clean}`],
              ] as [Filter, string][]).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={filter === value ? "range-option active" : "range-option"}
                  onClick={() => setFilter(value)}
                  aria-pressed={filter === value}
                >
                  {label}
                </button>
              ))}
            </div>
            {focus && (
              <button className="range-option active" type="button" onClick={() => setFocus(null)}>
                {focus} ✕
              </button>
            )}
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Zoek in URL of titel"
              className="grow"
            />
          </div>

          <table className="data audit-tree">
            <thead>
              <tr>
                <th>Pagina</th>
                <th>Status</th>
                {hasStats && <th className="num">Klikken</th>}
                <th>Health</th>
                <th>Bevindingen</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ page, parts }) => {
                const tags = labels(page);
                return (
                  <React.Fragment key={page.url}>
                    <tr
                      onClick={() => setOpen(open === page.url ? null : page.url)}
                      style={{ cursor: "pointer" }}
                    >
                      <td className="audit-tree-cell">
                        <span className="audit-indent" style={{ width: Math.max(0, parts.length - 1) * 14 }} />
                        <span className="audit-node">{parts.length === 0 ? "/" : parts[parts.length - 1]}</span>
                        {tags.map((tag) => (
                          <span
                            key={tag}
                            className={tag === "noindex" ? "audit-tag" : tag === "orphan" ? "audit-tag warn" : "audit-tag muted"}
                          >
                            {tag}
                          </span>
                        ))}
                        {page.title && <span className="audit-title-inline" title={page.title}>{page.title}</span>}
                      </td>
                      <td><span className={statusClass(page.status)}>{page.status}</span></td>
                      {hasStats && (
                        <td className="num">{stats[normalizeUrl(page.url)]?.clicks ?? "—"}</td>
                      )}
                      <td>
                        <div className="health-bar" title={`${page.score}/100`}>
                          <span
                            style={{ width: `${page.score}%`, background: healthColor(page.score) }}
                          />
                        </div>
                      </td>
                      <td>
                        {page.errors > 0 && <span className="badge red">{page.errors} fout</span>}
                        {page.warnings > 0 && (
                          <span className="badge yellow" style={{ marginLeft: page.errors > 0 ? 6 : 0 }}>
                            {page.warnings} waarschuwing
                          </span>
                        )}
                        {page.issues.length === 0 && <span className="badge green">in orde</span>}
                      </td>
                    </tr>
                    {open === page.url && (
                      <tr className="audit-detail">
                        <td colSpan={hasStats ? 5 : 4}>
                          <ul className="audit-list">
                            {page.issues.length === 0 && <li>Niets gevonden om aan te pakken.</li>}
                            {page.issues.map((finding, index) => (
                              <li key={`${finding.code}-${index}`}>
                                <span className={finding.severity === "error" ? "badge red" : "badge yellow"}>
                                  {finding.severity === "error" ? "fout" : "let op"}
                                </span>{" "}
                                {finding.message}
                              </li>
                            ))}
                          </ul>
                          <p className="hint" style={{ margin: "8px 0 0" }}>
                            {page.h1 ? `H1: ${page.h1} · ` : "Geen H1 · "}
                            {page.internal_links} interne links · {page.inbound} inkomend ·{" "}
                            {page.images - page.images_no_alt}/{page.images} afbeeldingen met alt ·{" "}
                            {page.schema.length > 0 ? page.schema.join(", ") : "geen structured data"} ·{" "}
                            {page.hreflang > 0 ? `${page.hreflang} hreflang-tags · ` : ""}
                            {page.ms} ms
                          </p>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>

          {rows.length === 0 && <p className="hint">Geen pagina's die bij dit filter passen.</p>}
        </>
      )}
    </div>
  );
}
