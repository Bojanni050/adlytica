import React, { useEffect, useRef, useState } from "react";
import {
  AdlySource, ChatMessage, adlyChat, adsApplyChange,
} from "../lib/api";
import { buildAdlySources } from "../lib/adlySources";
import { useDateRange } from "../lib/dateRange";
import Icon from "./Icon";

interface Props {
  accounts: Record<string, string>;
  /** Compacte opmaak voor de zijbalk: geen grote paginakop. */
  compact?: boolean;
}

interface AdlyAction {
  action: string;
  label: string;
  params: Record<string, unknown>;
}

interface UIMessage extends ChatMessage {
  id: number;
  executedActions?: string[];
  /** Bronnen die bij dit antwoord gebruikt zijn (zonder rijen in opslag). */
  sources?: AdlySource[];
}

const STORAGE_KEY = "adlytica.chat.history.v1";

/** Acties die de app echt veilig kan uitvoeren (zelfde whitelist als de backend). */
const EXECUTABLE = ["pause_campaign", "enable_campaign", "push_negative_keywords"];

const SUGGESTIONS = [
  "Analyseer mijn SEO-kansen en geef top 5 prioriteiten",
  "Welke campagnes kosten het meest en wat levert dat op?",
  "Waar verlies ik vertoningen in Search Console?",
  "Bekijk mijn campagneprestaties en geef optimalisatietips",
];

function loadHistory(): UIMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * De rijen van een brondossier zijn te groot voor localStorage (honderd
 * berichten × tientallen rijen). Bewaar alleen de kenmerken van de bron, zodat
 * een oud antwoord na een herstart nog steeds herkenbaar blijft als "gebaseerd
 * op [1] Search Console · top zoektermen".
 */
function trimForStorage(message: UIMessage): UIMessage {
  if (!message.sources?.length) return message;
  return { ...message, sources: message.sources.map((source) => ({ ...source, rows: [] })) };
}

function saveHistory(messages: UIMessage[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-100).map(trimForStorage)));
  } catch {
    /* opslag vol of niet beschikbaar */
  }
}

function parseAction(text: string): { action: AdlyAction; rest: string } | null {
  const match = text.match(/\[\[ACTION\]\]\s*(\{.*\})/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[1]);
    if (typeof obj.action !== "string" || typeof obj.params !== "object") return null;
    return {
      action: { action: obj.action, label: obj.label ?? obj.action, params: obj.params },
      rest: text.replace(match[0], "").trim(),
    };
  } catch {
    return null;
  }
}

function citedIds(text: string): number[] {
  const found = new Set<number>();
  for (const match of text.matchAll(/\[(\d+)\]/g)) {
    const id = Number(match[1]);
    if (Number.isFinite(id)) found.add(id);
  }
  return [...found];
}

function period(source: AdlySource): string {
  if (!source.date_from && !source.date_to) return "";
  return `${source.date_from} t/m ${source.date_to}`;
}

function SourceList({ sources, text }: { sources: AdlySource[]; text: string }) {
  const cited = citedIds(text);
  return (
    <div className="adly-sources">
      <div className="adly-sources-head">
        <span>Bronnen</span>
        {cited.length === 0 && (
          <span className="adly-sources-warn" title="Het antwoord verwijst niet naar een genummerde bron; controleer de cijfers zelf.">
            geen verwijzing in dit antwoord
          </span>
        )}
      </div>
      {sources.map((source) => (
        <div key={source.id} className={cited.includes(source.id) ? "adly-source cited" : "adly-source"}>
          <div className="adly-source-line">
            <span className="adly-source-id">[{source.id}]</span>
            <span className="adly-source-label">{source.label}</span>
            <span className="adly-source-meta">
              {[source.account, period(source), `${source.rows.length} rijen`].filter(Boolean).join(" · ")}
            </span>
          </div>
          {source.rows.length > 0 && (
            <details className="adly-source-detail">
              <summary>Bekijk de gebruikte rijen</summary>
              <div className="adly-source-table">
                <table className="data">
                  <thead>
                    <tr>
                      {source.fields.map((field) => <th key={field}>{field}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {source.rows.slice(0, 10).map((row, index) => (
                      <tr key={index}>
                        {row.map((value, cellIndex) => <td key={cellIndex}>{value}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {source.rows.length > 10 && (
                  <p className="hint">Eerste 10 van {source.rows.length} rijen — het model kreeg ze allemaal.</p>
                )}
              </div>
            </details>
          )}
        </div>
      ))}
    </div>
  );
}

export default function AdlyChat({ accounts, compact = false }: Props) {
  const { from, to } = useDateRange();
  const [messages, setMessages] = useState<UIMessage[]>(loadHistory);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [withContext, setWithContext] = useState(true);
  const [contextInfo, setContextInfo] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  async function buildDossier(): Promise<{ context?: string; sources?: AdlySource[] }> {
    if (!withContext) {
      setContextInfo("zonder data — antwoord is niet op cijfers gebaseerd");
      return {};
    }
    try {
      const dossier = await buildAdlySources({ accounts, from, to });
      setContextInfo(dossier.summary);
      return {
        context: `De gebruiker kijkt in de app naar de periode ${from} t/m ${to}. Alle cijfers staan in het brondossier hieronder.`,
        sources: dossier.sources,
      };
    } catch (e) {
      setContextInfo("databron ophalen mislukt — chat werkt zonder cijfers");
      return {};
    }
  }

  async function executeAction(msgId: number, act: AdlyAction) {
    if (!EXECUTABLE.includes(act.action)) {
      appendMessage(`⚠️ Deze actie (${act.action}) kan de app niet uitvoeren.`);
      return;
    }

    setMessages((prev) => {
      const next = prev.map((m) =>
        m.id === msgId
          ? { ...m, executedActions: [...(m.executedActions ?? []), act.label] }
          : m
      );
      saveHistory(next);
      return next;
    });

    try {
      const result = await adsApplyChange(act.action, act.params, act.label);
      if (result.entry.status === "mislukt") {
        appendMessage(`⚠️ Actie mislukt: ${result.entry.message ?? "onbekende fout"}`);
      } else {
        appendMessage(`✅ Uitgevoerd: ${act.label} — staat in het logboek bij Advertentiecampagnes en is daar terug te draaien.`);
      }
    } catch (e) {
      appendMessage(`⚠️ Actie mislukt: ${e}`);
    }
  }

  function appendMessage(content: string) {
    setMessages((prev) => {
      const next = [...prev, { id: Date.now(), role: "assistant" as const, content }];
      saveHistory(next);
      return next;
    });
  }

  async function send() {
    const text = input.trim();
    if (text === "" || busy) return;
    setInput("");

    const userMsg: UIMessage = { id: Date.now(), role: "user", content: text };
    const history = [...messages, userMsg];
    setMessages(history);
    saveHistory(history);
    setBusy(true);

    try {
      const { context, sources } = await buildDossier();
      const reply = await adlyChat(
        history.map(({ role, content }) => ({ role, content })),
        context,
        sources
      );
      const next = [
        ...history,
        { id: Date.now() + 1, role: "assistant" as const, content: reply, sources },
      ];
      setMessages(next);
      saveHistory(next);
    } catch (e) {
      const next = [...history, { id: Date.now() + 1, role: "assistant" as const, content: `⚠️ Fout: ${e}` }];
      setMessages(next);
      saveHistory(next);
    } finally {
      setBusy(false);
    }
  }

  function clearHistory() {
    setMessages([]);
    saveHistory([]);
  }

  return (
    <div className={compact ? "adly-chat compact" : "adly-chat"}>
      {!compact && (
        <div className="adly-header">
          <div>
            <h1>Adly — AI-assistent</h1>
            <p className="subtitle" style={{ marginBottom: 0 }}>
              Je AI-collega voor SEO en Google Ads
              {contextInfo ? ` · ${contextInfo}` : ""}
            </p>
          </div>
          {messages.length > 0 && (
            <button className="ghost" onClick={clearHistory}>Geschiedenis wissen</button>
          )}
        </div>
      )}

      {compact ? (
        <div className="adly-compact-tools">
          <label>
            <input
              type="checkbox"
              checked={withContext}
              onChange={(e) => setWithContext(e.target.checked)}
            />
            Data meesturen
          </label>
          {messages.length > 0 && (
            <button className="link" type="button" onClick={clearHistory}>Wissen</button>
          )}
        </div>
      ) : (
        <div className="chat-toolbar">
          <label style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--muted)", fontSize: 12 }}>
            <input
              type="checkbox" checked={withContext}
              onChange={(e) => setWithContext(e.target.checked)}
            />
            Stuur actuele SEO- en campagnedata mee
          </label>
        </div>
      )}

      {compact && contextInfo && <p className="hint adly-context">{contextInfo}</p>}

      <div className="chat-window">
        {messages.length === 0 && (
          <div className="chat-empty">
            <span className="chat-empty-mark">
              <Icon name="spark" size={compact ? 22 : 26} strokeWidth={1.3} />
            </span>
            <p>Hoi! Ik ben Adly. Vraag me alles over je SEO en advertenties.</p>
            <div className="chat-suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="ghost" onClick={() => setInput(s)}>{s}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => {
          const parsed = m.role === "assistant" ? parseAction(m.content) : null;
          const text = parsed ? parsed.rest : m.content;
          const alreadyDone = (m.executedActions ?? []).includes(parsed?.action.label ?? "");
          return (
            <div key={m.id} className={m.role === "user" ? "chat-msg user" : "chat-msg assistant"}>
              <div className="chat-bubble">
                {renderContent(text)}
                {parsed && (
                  <div className="action-box">
                    <button
                      className={alreadyDone ? "ghost" : "primary"}
                      disabled={alreadyDone}
                      onClick={() => executeAction(m.id, parsed.action)}
                    >
                      {alreadyDone ? "✓ Uitgevoerd" : `Uitvoeren: ${parsed.action.label}`}
                    </button>
                  </div>
                )}
                {m.role === "assistant" && m.sources && m.sources.length > 0 && (
                  <SourceList sources={m.sources} text={text} />
                )}
              </div>
            </div>
          );
        })}
        {busy && (
          <div className="chat-msg assistant">
            <div className="chat-bubble typing">Adly denkt na…</div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="chat-input-row">
        <input
          type="text"
          value={input}
          placeholder="Stel een vraag aan Adly…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <button className="primary" onClick={send} disabled={busy || input.trim() === ""}>
          Verstuur
        </button>
      </div>
    </div>
  );
}

function renderContent(content: string): React.ReactNode {
  const parts = content.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    const lines = part.split("\n");
    return (
      <React.Fragment key={i}>
        {lines.map((line, j) => (
          <React.Fragment key={j}>
            {line}
            {j < lines.length - 1 && <br />}
          </React.Fragment>
        ))}
      </React.Fragment>
    );
  });
}
