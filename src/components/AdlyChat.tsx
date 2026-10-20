import React, { useEffect, useRef, useState } from "react";
import {
  adlyChat, windsorAction, windsorQuery, num, dateNDaysAgo, ChatMessage,
} from "../lib/api";

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
}

const STORAGE_KEY = "adlytica.chat.history.v1";

const SUGGESTIONS = [
  "Analyseer mijn SEO-kansen en geef top 5 prioriteiten",
  "Ontwerp een nieuwe Search-campagne voor white-vision.nl",
  "Pauzeer de slechtst presterende campagne",
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

function saveHistory(messages: UIMessage[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-100)));
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

export default function AdlyChat({ accounts, compact = false }: Props) {
  const [messages, setMessages] = useState<UIMessage[]>(loadHistory);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [withContext, setWithContext] = useState(true);
  const [contextInfo, setContextInfo] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  async function buildContext(): Promise<string | undefined> {
    if (!withContext) return undefined;
    try {
      const [gsc, ads] = await Promise.all([
        windsorQuery({
          connector: "searchconsole", account: accounts.searchconsole,
          fields: ["query", "clicks", "impressions", "ctr", "position"],
          date_from: dateNDaysAgo(89), group_by: ["query"], limit: 3000,
        }),
        windsorQuery({
          connector: "google_ads", account: accounts.google_ads,
          fields: ["campaign_id", "campaign_name", "status", "spend", "clicks", "impressions", "conversions"],
          date_from: dateNDaysAgo(29), group_by: ["campaign_id"], limit: 200,
          options: { include_inactive: "true" },
        }),
      ]);

      const topQueries = gsc
        .sort((a, b) => num(b.impressions) - num(a.impressions))
        .slice(0, 30)
        .map((r) => `${r.query} | klikken ${num(r.clicks)} | impr ${num(r.impressions)} | ctr ${num(r.ctr).toFixed(1)}% | pos ${num(r.position).toFixed(1)}`)
        .join("\n");

      const chances = gsc
        .filter((r) => num(r.position) >= 5 && num(r.position) <= 20 && num(r.impressions) > 100)
        .sort((a, b) => num(b.impressions) - num(a.impressions))
        .slice(0, 15)
        .map((r) => `${r.query} | impr ${num(r.impressions)} | pos ${num(r.position).toFixed(1)} | ctr ${num(r.ctr).toFixed(1)}%`)
        .join("\n");

      const campaigns = ads
        .map((r) => `campaign_id ${r.campaign_id}: ${r.campaign_name} | status ${r.status} | kosten ${num(r.spend).toFixed(2)} | klikken ${num(r.clicks)} | conv ${num(r.conversions)}`)
        .join("\n") || "(geen campagnes)";

      const ctx =
        `SEARCH CONSOLE (laatste 90 dagen) — top 30 zoektermen op impressies:\n${topQueries}\n\n` +
        `SEO-KANSEN (positie 5-20, >100 impressies):\n${chances || "(geen)"}\n\n` +
        `GOOGLE ADS CAMPAGNES (laatste 30 dagen, campaign_id is de unieke ID):\n${campaigns}`;
      setContextInfo(`${gsc.length} zoektermen · ${ads.length} campagnes meegestuurd`);
      return ctx;
    } catch {
      setContextInfo("context ophalen mislukt — chat werkt zonder datacontext");
      return undefined;
    }
  }

  async function executeAction(msgId: number, act: AdlyAction) {
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
      const params = { ...act.params };
      const microsKeys = ["amount", "target_cpa", "cpc_bid_ceiling"];
      for (const key of microsKeys) {
        if (typeof params[key] === "number") {
          (params as Record<string, unknown>)[key === "amount" ? "amount_micros" : `${key}_micros`] =
            Math.round((params[key] as number) * 1_000_000);
          delete params[key];
        }
      }

      await windsorAction("google_ads", accounts.google_ads, act.action, params);
      setMessages((prev) => {
        const next = [
          ...prev,
          { id: Date.now(), role: "assistant" as const, content: `✅ Uitgevoerd: ${act.label}` },
        ];
        saveHistory(next);
        return next;
      });
    } catch (e) {
      setMessages((prev) => {
        const next = [
          ...prev,
          { id: Date.now(), role: "assistant" as const, content: `⚠️ Actie mislukt: ${e}` },
        ];
        saveHistory(next);
        return next;
      });
    }
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
      const context = await buildContext();
      const reply = await adlyChat(
        history.map(({ role, content }) => ({ role, content })),
        context
      );
      const next = [...history, { id: Date.now() + 1, role: "assistant" as const, content: reply }];
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
              {contextInfo ? ` · context: ${contextInfo}` : ""}
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
            <div style={{ fontSize: compact ? 24 : 28 }}>◉</div>
            <p>Hoi! Ik ben Adly. Vraag me anything over je SEO of advertenties.</p>
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
