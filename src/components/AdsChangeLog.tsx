import React, { useState } from "react";
import { ChangeLogEntry, adsApplyChange } from "../lib/api";

interface Props {
  entries: ChangeLogEntry[];
  onChanged: (log: ChangeLogEntry[]) => void;
  onError: (message: string) => void;
}

const ACTION_LABEL: Record<string, string> = {
  pause_campaign: "Campagne pauzeren",
  enable_campaign: "Campagne activeren",
  push_negative_keywords: "Negative keywords toevoegen",
};

const UNDO_ACTION: Record<string, string> = {
  pause_campaign: "enable_campaign",
  enable_campaign: "pause_campaign",
};

function formatMoment(value: string): string {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("nl-NL", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

/** Logboek van wijzigingen in Google Ads, met ongedaan maken waar dat kan. */
export default function AdsChangeLog({ entries, onChanged, onError }: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const visible = entries.slice(0, 20);

  async function undo(entry: ChangeLogEntry) {
    const action = UNDO_ACTION[entry.action];
    if (!action) return;
    setBusyId(entry.id);
    try {
      const result = await adsApplyChange(
        action,
        entry.params,
        `${ACTION_LABEL[entry.action] ?? entry.action} ongedaan maken · ${entry.title}`,
        entry.id
      );
      if (result.entry.status === "mislukt") {
        onError(result.entry.message ?? "Ongedaan maken is mislukt.");
      }
      onChanged(result.log);
    } catch (exception) {
      onError(String(exception));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3>Wijzigingen in Google Ads</h3>
      <p className="hint">
        Alles wat de app heeft doorgevoerd staat hier, ook mislukte pogingen. Er gaan maximaal 20
        wijzigingen per dag door; daarna moet je het morgen opnieuw proberen.
      </p>
      {visible.length === 0 ? (
        <p className="hint" style={{ padding: "8px 0" }}>
          Nog geen wijzigingen doorgevoerd.
        </p>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>Wanneer</th>
              <th>Wijziging</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visible.map((entry) => {
              const canUndo = Boolean(UNDO_ACTION[entry.action]) && entry.status === "uitgevoerd";
              return (
                <tr key={entry.id}>
                  <td>{formatMoment(entry.at)}</td>
                  <td>
                    {entry.title}
                    <div className="hint" style={{ margin: 0 }}>
                      {entry.message
                        ? entry.message
                        : ACTION_LABEL[entry.action] ?? entry.action}
                      {entry.undo_of ? " · ongedaan gemaakt" : ""}
                    </div>
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        entry.status === "uitgevoerd"
                          ? "green"
                          : entry.status === "teruggedraaid"
                          ? "yellow"
                          : "red"
                      }`}
                    >
                      {entry.status}
                    </span>
                  </td>
                  <td>
                    {canUndo && (
                      <button
                        className="ghost"
                        onClick={() => undo(entry)}
                        disabled={busyId !== null}
                      >
                        {busyId === entry.id ? "Bezig…" : "Ongedaan maken"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
