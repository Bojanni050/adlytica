import React, { useMemo, useState } from "react";
import { runAudit, AuditPage, AuditResult } from "../lib/api";
import { exportPdf } from "../lib/pdf";

type Filter = "all" | "error" | "warning" | "clean";

const LIMITS = [25, 50, 100, 250];

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

export default function Audit() {
  const [url, setUrl] = useState(() => localStorage.getItem("adlytica.audit.url") ?? "");
  const [limit, setLimit] = useState(() => Number(localStorage.getItem("adlytica.audit.limit") ?? 100));
  const [result, setResult] = useState<AuditResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfMsg, setPdfMsg] = useState<string | null>(null);

  async function start() {
    if (busy) return;
    setBusy(true);
    setError(null);
    localStorage.setItem("adlytica.audit.url", url.trim());
    localStorage.setItem("adlytica.audit.limit", String(limit));
    try {
      const audit = await runAudit(url.trim(), limit);
      setResult(audit);
      setOpen(null);
      setFilter("all");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function exportReport() {
    if (!result) return;
    setPdfBusy(true);
    setPdfMsg(null);
    try {
      const host = (() => {
        try {
          return new URL(result.base).hostname;
        } catch {
          return result.base;
        }
      })();
      const stamp = new Date().toISOString().slice(0, 10);
      const withIssues = result.pages.filter((page) => page.issues.length > 0);
      const rows = withIssues.slice(0, 80).map((page) => {
        const problems = page.issues
          .map((item) => `${item.severity === "error" ? "fout" : "let op"}: ${item.message}`)
          .join("; ");
        return [shortPath(page), String(page.status), String(page.errors), String(page.warnings), problems];
      });
      const path = await exportPdf({
        title: "Technische audit",
        subtitle: `${host} · ${result.crawled} pagina's · ${(result.duration_ms / 1000).toFixed(1)} s`,
        kpis: [
          { label: "Pagina's", value: String(totals.pages) },
          { label: "Fouten", value: String(totals.errors) },
          { label: "Waarschuwingen", value: String(totals.warnings) },
          { label: "Zonder meta", value: String(totals.noMeta) },
          { label: "Zonder H1", value: String(totals.noH1) },
        ],
        sections: [
          {
            title: "Site-brede controles",
            head: ["Controle", "Status", "Toelichting"],
            rows: result.checks.map((check) => [check.label, check.ok ? "in orde" : "aandacht", check.detail]),
          },
          {
            title: "Bevindingen per pagina",
            head: ["Pagina", "Status", "Fouten", "Let op", "Bevindingen"],
            rows,
            note: withIssues.length === 0
              ? "Geen problemen gevonden op de gecontroleerde pagina's."
              : `${withIssues.length} van ${result.pages.length} pagina's hebben aandachtspunten${withIssues.length > rows.length ? ` (eerste ${rows.length} in dit rapport)` : ""}.`,
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

  const totals = useMemo(() => {
    const pages = result?.pages ?? [];
    return {
      pages: pages.length,
      errors: pages.reduce((sum, p) => sum + p.errors, 0),
      warnings: pages.reduce((sum, p) => sum + p.warnings, 0),
      noMeta: pages.filter((p) => p.meta_len === 0).length,
      noH1: pages.filter((p) => p.h1_count === 0).length,
    };
  }, [result]);

  const rows = useMemo(() => {
    const pages = result?.pages ?? [];
    const needle = search.trim().toLowerCase();
    return pages.filter((page) => {
      if (filter === "error" && page.errors === 0) return false;
      if (filter === "warning" && page.warnings === 0) return false;
      if (filter === "clean" && page.issues.length > 0) return false;
      if (needle === "") return true;
      return page.url.toLowerCase().includes(needle) || page.title.toLowerCase().includes(needle);
    });
  }, [result, filter, search]);

  const counts = useMemo(() => {
    const pages = result?.pages ?? [];
    return {
      all: pages.length,
      error: pages.filter((p) => p.errors > 0).length,
      warning: pages.filter((p) => p.warnings > 0).length,
      clean: pages.filter((p) => p.issues.length === 0).length,
    };
  }, [result]);

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
        <button className="ghost" onClick={exportReport} disabled={pdfBusy || !result || busy}>
          {pdfBusy ? "PDF…" : "⬇ PDF"}
        </button>
      </div>

      {busy && (
        <p className="hint">
          De crawler haalt de pagina's op. Bij 100 pagina's duurt dit ongeveer een halve minuut.
        </p>
      )}
      {error && <p className="hint" style={{ color: "var(--danger)" }}>{error}</p>}
      {pdfMsg && <p className="hint">{pdfMsg}</p>}

      {!result && !busy && (
        <div className="card">
          <h3>Wat er gecontroleerd wordt</h3>
          <ul className="audit-list">
            <li><strong>Fouten</strong> — status 4xx/5xx, ontbrekende title of H1.</li>
            <li><strong>Waarschuwingen</strong> — title- en meta-lengte, meerdere H1's, canonical, noindex, dunne tekst, alt-teksten, dubbele titles en H1's, trage respons, ontbrekende structured data.</li>
            <li><strong>Site-breed</strong> — https, robots.txt en of er een sitemap is (die bepaalt welke URL's worden gecontroleerd).</li>
          </ul>
        </div>
      )}

      {result && (
        <>
          <div className="audit-kpis">
            <div className="card">
              <div className="stat-value">{totals.pages}</div>
              <div className="stat-label">pagina's gecontroleerd</div>
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
              <div className="stat-label">zonder meta-omschrijving</div>
            </div>
            <div className="card">
              <div className="stat-value">{totals.noH1}</div>
              <div className="stat-label">zonder H1</div>
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

          <div className="toolbar" style={{ marginTop: 16 }}>
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
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Zoek in URL of titel"
              className="grow"
            />
          </div>

          <table className="data">
            <thead>
              <tr>
                <th>Pagina</th>
                <th>Status</th>
                <th>Title</th>
                <th className="num">Meta</th>
                <th className="num">Woorden</th>
                <th>Bevindingen</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((page) => (
                <React.Fragment key={page.url}>
                  <tr
                    onClick={() => setOpen(open === page.url ? null : page.url)}
                    style={{ cursor: "pointer" }}
                  >
                    <td className="audit-url" title={page.url}>{shortPath(page)}</td>
                    <td><span className={statusClass(page.status)}>{page.status}</span></td>
                    <td className="audit-title" title={page.title}>{page.title || "—"}</td>
                    <td className="num">{page.meta_len}</td>
                    <td className="num">{page.words}</td>
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
                      <td colSpan={6}>
                        <ul className="audit-list">
                          {page.issues.length === 0 && <li>Niets gevonden om aan te pakken.</li>}
                          {page.issues.map((issue, index) => (
                            <li key={`${issue.code}-${index}`}>
                              <span className={issue.severity === "error" ? "badge red" : "badge yellow"}>
                                {issue.severity === "error" ? "fout" : "let op"}
                              </span>{" "}
                              {issue.message}
                            </li>
                          ))}
                        </ul>
                        <p className="hint" style={{ margin: "8px 0 0" }}>
                          {page.h1 ? `H1: ${page.h1} · ` : "Geen H1 · "}
                          {page.internal_links} interne links · {page.external_links} externe links ·{" "}
                          {page.images - page.images_no_alt}/{page.images} afbeeldingen met alt ·{" "}
                          {page.schema.length > 0 ? page.schema.join(", ") : "geen structured data"} ·{" "}
                          {page.ms} ms
                        </p>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>

          {rows.length === 0 && <p className="hint">Geen pagina's die bij dit filter passen.</p>}
        </>
      )}
    </div>
  );
}
