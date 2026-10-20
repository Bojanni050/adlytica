import React, { useEffect, useMemo, useState } from "react";
import {
  runAudit, windsorQuery, dateNDaysAgo, AuditPage, AuditResult, Row,
} from "../lib/api";
import { exportPdf } from "../lib/pdf";

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

  useEffect(() => {
    localStorage.setItem("adlytica.audit.limit", String(limit));
  }, [limit]);

  async function loadStats(base: string): Promise<Record<string, PageStats>> {
    if (!accounts.searchconsole) return {};
    try {
      const rows: Row[] = await windsorQuery({
        connector: "searchconsole",
        account: accounts.searchconsole,
        fields: ["page", "clicks", "impressions"],
        date_from: dateNDaysAgo(89),
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
            title: "Pagina's",
            head: ["Pagina", "Status", "Health", "Klikken", "Bevindingen"],
            rows: pages.slice(0, 80),
            note: pages.length > 80 ? `${pages.length - 80} pagina's staan niet in dit rapport.` : undefined,
          },
        ],
        filename: `adlytica-audit-${host}-${stamp}.pdf`,
      });
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
      {pdfMsg && <p className="hint">{pdfMsg}</p>}
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
