import React, { createContext, useContext, useMemo, useState } from "react";
import { dateNDaysAgo } from "./api";
import Icon from "../components/Icon";

export type DateRange = {
  from: string;
  to: string;
  days: number;
  label: string;
};

type DateRangeContextValue = DateRange & {
  preset: number | "custom";
  setPreset: (value: number | "custom") => void;
  setCustom: (from: string, to: string) => void;
};

const STORAGE_KEY = "adlytica.date-range";
const PRESETS = [7, 30, 90, 180];
const DateRangeContext = createContext<DateRangeContextValue | null>(null);

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Verschuift een YYYY-MM-DD met een aantal dagen (UTC, dus geen DST-verrassingen). */
export function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function readStored(): { preset: number | "custom"; from: string; to: string } {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!parsed) return { preset: 90, from: dateNDaysAgo(89), to: today() };
    const preset = parsed.preset === "custom" ? "custom" : Number(parsed.preset);
    if (preset !== "custom" && !PRESETS.includes(preset)) return { preset: 90, from: dateNDaysAgo(89), to: today() };
    const from = typeof parsed.from === "string" ? parsed.from : dateNDaysAgo(89);
    const to = typeof parsed.to === "string" ? parsed.to : today();
    return { preset, from, to };
  } catch {
    return { preset: 90, from: dateNDaysAgo(89), to: today() };
  }
}

export function DateRangeProvider({ children }: { children: React.ReactNode }) {
  const initial = useMemo(readStored, []);
  const [preset, setPresetState] = useState<number | "custom">(initial.preset);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);

  function persist(next: { preset: number | "custom"; from: string; to: string }) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* optional */ }
  }

  function setPreset(value: number | "custom") {
    if (value === "custom") { setPresetState(value); return; }
    const next = { preset: value, from: dateNDaysAgo(value - 1), to: today() };
    setPresetState(value); setFrom(next.from); setTo(next.to); persist(next);
  }

  function setCustom(nextFrom: string, nextTo: string) {
    if (!nextFrom || !nextTo || nextFrom > nextTo) return;
    const next = { preset: "custom" as const, from: nextFrom, to: nextTo };
    setPresetState("custom"); setFrom(nextFrom); setTo(nextTo); persist(next);
  }

  const days = Math.max(1, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1);
  const value = useMemo(() => ({
    from, to, days, preset,
    label: preset === "custom" ? `${from} t/m ${to}` : `laatste ${days} dagen`,
    setPreset, setCustom,
  }), [from, to, days, preset]);
  return <DateRangeContext.Provider value={value}>{children}</DateRangeContext.Provider>;
}

export function useDateRange(): DateRangeContextValue {
  const value = useContext(DateRangeContext);
  if (!value) throw new Error("useDateRange must be used inside DateRangeProvider");
  return value;
}

/** Kort bereik-label voor in de topbalk: "12 aug – 9 nov". */
const DAY_MONTH = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short" });

function shortRange(from: string, to: string): string {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return `${from} – ${to}`;
  return `${DAY_MONTH.format(start)} – ${DAY_MONTH.format(end)}`;
}

export function DateRangeSelector() {
  const { from, to, preset, setPreset, setCustom } = useDateRange();
  return (
    <div className="global-date-range period" role="group" aria-label="Datumbereik">
      <Icon name="calendar" size={14} className="period-icon" />
      <div className="range-switch">
        {[7, 30, 90, 180].map((days) => (
          <button
            key={days}
            type="button"
            className={preset === days ? "range-option active" : "range-option"}
            onClick={() => setPreset(days)}
            aria-pressed={preset === days}
            title={`Laatste ${days} dagen`}
          >
            {days}d
          </button>
        ))}
        <button
          type="button"
          className={preset === "custom" ? "range-option active" : "range-option"}
          onClick={() => setPreset("custom")}
          aria-pressed={preset === "custom"}
        >
          eigen
        </button>
      </div>
      {preset === "custom" ? (
        <div className="period-custom">
          <input aria-label="Vanaf" type="date" value={from} onChange={(e) => setCustom(e.target.value, to)} />
          <span>–</span>
          <input aria-label="Tot en met" type="date" value={to} onChange={(e) => setCustom(from, e.target.value)} />
        </div>
      ) : (
        <span className="global-date-label" style={{ letterSpacing: 0 }}>{shortRange(from, to)}</span>
      )}
    </div>
  );
}
