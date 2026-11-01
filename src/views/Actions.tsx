import React, { useEffect, useMemo, useState } from "react";
import { ACTION_STATUSES, ActionItem, ActionStatus } from "../lib/api";
import {
  ACTIONS_EVENT, addManualAction, countOpenActions, loadActions, removeAction, setActionStatus,
} from "../lib/actions";

interface Props {
  onNavigate?: (view: string) => void;
}

const STATUS_LABEL: Record<ActionStatus, string> = {
  nieuw: "Nieuw",
  gezien: "Gezien",
  uitgevoerd: "Uitgevoerd",
  genegeerd: "Genegeerd",
};

/** Alleen de views waar een actie echt heen kan. */
const TARGETS: { id: string; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "insights", label: "Zoekanalyse" },
  { id: "seo", label: "SEO Analyse" },
  { id: "keywords", label: "Zoekwoorden" },
  { id: "rankings", label: "Posities" },
  { id: "searchterms", label: "Zoektermen" },
  { id: "campaigns", label: "Campagnes" },
  { id: "reports", label: "Rapport" },
  { id: "audit", label: "Audit" },
];

function formatStamp(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("nl-NL", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function Actions({ onNavigate }: Props) {
  const [items, setItems] = useState<ActionItem[]>([]);
  const [filter, setFilter] = useState<ActionStatus | "alle">("alle");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const list = await loadActions();
        if (!cancelled) {
          setItems(list);
          setError(null);
        }
      } catch (exception) {
        if (!cancelled) setError(String(exception));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    refresh();
    function onChange() { void refresh(); }
    window.addEventListener(ACTIONS_EVENT, onChange);
    return () => {
      cancelled = true;
      window.removeEventListener(ACTIONS_EVENT, onChange);
    };
  }, []);

  const counters = useMemo(() => {
    const result: Record<ActionStatus | "alle", number> = {
      alle: items.length, nieuw: 0, gezien: 0, uitgevoerd: 0, genegeerd: 0,
    };
    for (const item of items) result[item.status] += 1;
    return result;
  }, [items]);

  const visible = filter === "alle" ? items : items.filter((item) => item.status === filter);

  async function submitManual(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      setItems(await addManualAction(title, detail, target === "" ? null : target));
      setTitle("");
      setDetail("");
      setTarget("");
      setError(null);
    } catch (exception) {
      setError(String(exception));
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(item: ActionItem, status: ActionStatus) {
    try {
      setItems(await setActionStatus(items, item.id, status));
    } catch (exception) {
      setError(String(exception));
    }
  }

  async function remove(item: ActionItem) {
    try {
      setItems(await removeAction(items, item.id));
    } catch (exception) {
      setError(String(exception));
    }
  }

  return (
    <div>
      <h1>Actiecentrum</h1>
      <p className="subtitle">
        Signalen van het dashboard en je eigen taken op één plek. Alles blijft lokaal in
        config.json — de app past zelf niets aan in je advertenties of website.
      </p>

      {error && <div className="error-box">{error}</div>}

      <div className="card">
        <form onSubmit={submitManual}>
          <h3>Nieuwe taak</h3>
          <div className="form-row">
            <div>
              <label className="field">Titel</label>
              <input
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Bijv. titel van de zwembadpagina herschrijven"
              />
            </div>
          </div>
          <div className="form-row">
            <div>
              <label className="field">Toelichting (optioneel)</label>
              <input
                type="text"
                value={detail}
                onChange={(event) => setDetail(event.target.value)}
                placeholder="Waarom of hoe je dit gaat aanpakken"
              />
            </div>
            <div style={{ maxWidth: 220 }}>
              <label className="field">Horen bij</label>
              <select value={target} onChange={(event) => setTarget(event.target.value)}>
                <option value="">Geen view</option>
                {TARGETS.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            </div>
          </div>
          <button type="submit" className="primary" disabled={busy || title.trim() === ""}>
            {busy ? "Bezig…" : "Taak toevoegen"}
          </button>
        </form>
      </div>

      <div className="action-filters" role="group" aria-label="Filter op status">
        {(["alle", ...ACTION_STATUSES] as const).map((value) => (
          <button
            key={value}
            type="button"
            className={filter === value ? "chip active" : "chip"}
            onClick={() => setFilter(value)}
            aria-pressed={filter === value}
          >
            {value === "alle" ? "Alle" : STATUS_LABEL[value]}
            <span className="chip-count">{counters[value]}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <p className="hint">Taken laden…</p>
      ) : visible.length === 0 ? (
        <div className="dash-empty">
          <div className="dash-empty-icon">☑</div>
          <h2>{filter === "alle" ? "Nog geen taken" : `Geen taken met status ${STATUS_LABEL[filter as ActionStatus].toLowerCase()}`}</h2>
          <p className="hint">
            {filter === "alle"
              ? "Maak er hierboven één aan, of zet een signaal op het dashboard om in een taak."
              : "Kies een ander filter om de rest te zien."}
          </p>
        </div>
      ) : (
        <ul className="action-list">
          {visible.map((item) => (
            <li key={item.id} className={`action-item ${item.status}`}>
              <div className="action-main">
                <div className="action-title">{item.title}</div>
                {item.detail && <p className="hint">{item.detail}</p>}
                <div className="action-meta">
                  <span className={`badge ${item.source === "alert" ? "blue" : "green"}`}>
                    {item.source === "alert" ? "signaal" : "handmatig"}
                  </span>
                  <span>{formatStamp(item.created_at)}</span>
                  {item.view && onNavigate && (
                    <button type="button" className="link" onClick={() => item.view && onNavigate(item.view)}>
                      Open {TARGETS.find((option) => option.id === item.view)?.label ?? "view"}
                    </button>
                  )}
                </div>
              </div>
              <div className="action-controls">
                {ACTION_STATUSES.filter((status) => status !== item.status).map((status) => (
                  <button
                    key={status}
                    type="button"
                    className="ghost action-status"
                    onClick={() => changeStatus(item, status)}
                  >
                    {status === "gezien" ? "Gezien" : status === "uitgevoerd" ? "Uitgevoerd" : status === "genegeerd" ? "Negeren" : "Heropenen"}
                  </button>
                ))}
                <button type="button" className="ghost action-remove" onClick={() => remove(item)} aria-label="Taak verwijderen">
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {items.length > 0 && (
        <p className="hint" style={{ marginTop: 12 }}>
          {countOpenActions(items)} open · {items.length} totaal
        </p>
      )}
    </div>
  );
}
