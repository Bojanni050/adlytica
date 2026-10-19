import React, { useEffect, useRef, useState } from "react";
import {
  adlyChat, windsorQuery, num, dateNDaysAgo, ChatMessage,
} from "../lib/api";

interface Props { accounts: Record<string, string>; }

interface UIMessage extends ChatMessage {
  id: number;
}

const SUGGESTIONS = [
  "Analyseer mijn SEO-kansen en geef top 5 prioriteiten",
  "Ontwerp een nieuwe Search-campagne voor white-vision.nl",
  "Hoe kan ik mijn CTR op zoektermen met positie 5-10 verbeteren?",
  "Bekijk mijn campagneprestaties en geef optimalisatietips",
];

export default function Adly({ accounts }: Props) {
  const [messages, setMessages] = useState<UIMessage[]>([]);
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
          fields: ["campaign_name", "status", "spend", "clicks", "impressions", "conversions"],
          date_from: dateNDaysAgo(29), group_by: ["campaign_name"], limit: 200,
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
        .map((r) => `${r.campaign_name} | status ${r.status} | kosten ${num(r.spend).toFixed(2)} | klikken ${num(r.clicks)} | conv ${num(r.conversions)}`)
        .join("\n") || "(geen campagnes)";

      const ctx =
        `SEARCH CONSOLE (laatste 90 dagen) — top 30 zoektermen op impressies:\n${topQueries}\n\n` +
        `SEO-KANSEN (positie 5-20, >100 impressies):\n${chances || "(geen)"}\n\n` +
        `GOOGLE ADS CAMPAGNES (laatste 30 dagen):\n${campaigns}`;
      setContextInfo(`${gsc.length} zoektermen · ${ads.length} campagnes meegestuurd`);
      return ctx;
    } catch {
      setContextInfo("context ophalen mislukt — chat werkt zonder datacontext");
      return undefined;
    }
  }

  async function send() {
    const text = input.trim();
    if (text === "" || busy) return;
    setInput("");

    const userMsg: UIMessage = { id: Date.now(), role: "user", content: text };
    const history = [...messages, userMsg];
    setMessages(history);
    setBusy(true);

    try {
      const context = await buildContext();
      const reply = await adlyChat(
        history.map(({ role, content }) => ({ role, content })),
        context
      );
      setMessages([...history, { id: Date.now() + 1, role: "assistant", content: reply }]);
    } catch (e) {
      setMessages([...history, {
        id: Date.now() + 1,
        role: "assistant",
        content: `⚠️ Fout: ${e}`,
      }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <h1>Adly — AI-assistent</h1>
      <p className="subtitle">
        Je AI-collega voor SEO en Google Ads
        {contextInfo ? ` · context: ${contextInfo}` : withContext ? " · context: actuele data wordt opgehaald per bericht" : ""}
      </p>

      <div className="chat-toolbar">
        <label style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--muted)", fontSize: 12 }}>
          <input
            type="checkbox" checked={withContext}
            onChange={(e) => setWithContext(e.target.checked)}
          />
          Stuur actuele SEO- en campagnedata mee
        </label>
      </div>

      <div className="chat-window">
        {messages.length === 0 && (
          <div className="chat-empty">
            <div style={{ fontSize: 28 }}>◉</div>
            <p>Hoi! Ik ben Adly. Vraag me anything over je SEO of advertenties.</p>
            <div className="chat-suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="ghost" onClick={() => setInput(s)}>{s}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "chat-msg user" : "chat-msg assistant"}>
            <div className="chat-bubble">{renderContent(m.content)}</div>
          </div>
        ))}
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
