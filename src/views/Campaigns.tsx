import React, { useEffect, useState } from "react";
import {
  windsorQuery, windsorAction, num, fmt, dateNDaysAgo, Row,
} from "../lib/api";

interface Props { accounts: Record<string, string>; }

interface CampaignRow {
  id: string;
  name: string;
  status: string;
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
}

export default function Campaigns({ accounts }: Props) {
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  async function loadCampaigns() {
    setLoading(true);
    setError(null);
    try {
      const rows = await windsorQuery({
        connector: "google_ads", account: accounts.google_ads,
        fields: [
          "campaign_id", "campaign_name", "status",
          "spend", "clicks", "impressions", "conversions",
        ],
        date_from: dateNDaysAgo(29), group_by: ["campaign_id"], limit: 500,
        options: { include_inactive: "true" },
      });
      setCampaigns(
        rows.map((r) => ({
          id: String(r.campaign_id ?? ""),
          name: String(r.campaign_name ?? ""),
          status: String(r.status ?? "UNKNOWN"),
          spend: num(r.spend),
          clicks: num(r.clicks),
          impressions: num(r.impressions),
          conversions: num(r.conversions),
        }))
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadCampaigns(); /* eslint-disable-next-line */ }, [accounts]);

  async function toggleCampaign(c: CampaignRow, action: "pause_campaign" | "enable_campaign") {
    try {
      await windsorAction("google_ads", accounts.google_ads, action, { campaign_id: c.id });
      setNotice(`Campaign "${c.name}" ${action === "pause_campaign" ? "gepauzeerd" : "geactiveerd"}.`);
      loadCampaigns();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div>
      <h1>Advertentiecampagnes</h1>
      <p className="subtitle">Google Ads — laatste 30 dagen, inclusief gepauzeerde campagnes</p>

      {error && <div className="error-box">{error}</div>}
      {notice && <div className="card" style={{ borderColor: "var(--accent-2)", marginBottom: 16 }}>
        <span style={{ color: "var(--accent-2)" }}>{notice}</span>
      </div>}

      <div className="toolbar">
        <div className="grow" />
        <button className="primary" onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? "Annuleren" : "+ Nieuwe campagne"}
        </button>
      </div>

      {showCreate && <CreateCampaignForm accounts={accounts} onCreated={() => { setShowCreate(false); loadCampaigns(); }} />}

      {loading ? (
        <div className="loading">Campagnes laden…</div>
      ) : (
        <div className="card">
          <table className="data">
            <thead>
              <tr>
                <th>Campagne</th>
                <th>Status</th>
                <th className="num">Kosten</th>
                <th className="num">Klikken</th>
                <th className="num">Impr.</th>
                <th className="num">Conv.</th>
                <th>Actie</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>
                    <span className={`badge ${c.status.toUpperCase() === "ENABLED" ? "green" : c.status.toUpperCase() === "PAUSED" ? "yellow" : "red"}`}>
                      {c.status}
                    </span>
                  </td>
                  <td className="num">{fmt(c.spend, 2)}</td>
                  <td className="num">{fmt(c.clicks, 0)}</td>
                  <td className="num">{fmt(c.impressions, 0)}</td>
                  <td className="num">{fmt(c.conversions, 0)}</td>
                  <td>
                    {c.status.toUpperCase() === "ENABLED" ? (
                      <button className="ghost" onClick={() => toggleCampaign(c, "pause_campaign")}>Pauzeren</button>
                    ) : c.status.toUpperCase() === "PAUSED" ? (
                      <button className="ghost" onClick={() => toggleCampaign(c, "enable_campaign")}>Activeren</button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {campaigns.length === 0 && <p className="hint" style={{ padding: 12 }}>Geen campagnes gevonden.</p>}
        </div>
      )}
    </div>
  );
}

function CreateCampaignForm({ accounts, onCreated }: { accounts: Record<string, string>; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [budget, setBudget] = useState("10");
  const [channel, setChannel] = useState("search");
  const [bidding, setBidding] = useState("manual_cpc");
  const [status, setStatus] = useState("paused");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"campaign" | "adgroup">("campaign");
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [agName, setAgName] = useState("");
  const [agCpc, setAgCpc] = useState("1.00");
  const [adHeadlines, setAdHeadlines] = useState<string[]>(["", "", ""]);
  const [adDescriptions, setAdDescriptions] = useState<string[]>(["", ""]);
  const [adUrl, setAdUrl] = useState("https://white-vision.nl/");

  async function createCampaign() {
    setBusy(true); setError(null);
    try {
      const result = (await windsorAction("google_ads", accounts.google_ads, "create_campaign", {
        name, channel_type: channel, bidding_strategy: bidding,
        budget_amount_micros: Math.round(parseFloat(budget) * 1_000_000),
        status,
      })) as Record<string, unknown>;
      const id = String(result?.campaign_id ?? result?.id ?? "");
      setCampaignId(id);
      setStep("adgroup");
    } catch (e) { setError(String(e)); }
    setBusy(false);
  }

  async function createAdGroup() {
    if (!campaignId) return;
    setBusy(true); setError(null);
    try {
      await windsorAction("google_ads", accounts.google_ads, "create_ad_group", {
        campaign_id: campaignId, name: agName,
        cpc_bid_micros: Math.round(parseFloat(agCpc) * 1_000_000),
        status: "paused",
      });
      onCreated();
    } catch (e) { setError(String(e)); }
    setBusy(false);
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h3>{step === "campaign" ? "Stap 1: Campagne aanmaken" : "Stap 2: Ad group aanmaken"}</h3>
      {error && <div className="error-box">{error}</div>}
      {step === "campaign" ? (
        <>
          <div className="form-row">
            <div><label className="field">Naam</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="bijv. Zoekcampagne — DUI" /></div>
            <div><label className="field">Dagbudget (€)</label>
              <input type="text" value={budget} onChange={(e) => setBudget(e.target.value)} /></div>
          </div>
          <div className="form-row">
            <div><label className="field">Kanaal</label>
              <select value={channel} onChange={(e) => setChannel(e.target.value)}>
                <option value="search">Search</option>
                <option value="display">Display</option>
              </select></div>
            <div><label className="field">Biedstrategie</label>
              <select value={bidding} onChange={(e) => setBidding(e.target.value)}>
                <option value="manual_cpc">Manual CPC</option>
                <option value="maximize_conversions">Maximize Conversions</option>
                <option value="target_spend">Target Spend</option>
              </select></div>
            <div><label className="field">Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="paused">Gepauzeerd (aanbevolen)</option>
                <option value="enabled">Direct actief</option>
              </select></div>
          </div>
          <button className="primary" onClick={createCampaign} disabled={busy || !name || !budget}>
            {busy ? "Aanmaken…" : "Campagne aanmaken"}
          </button>
        </>
      ) : (
        <>
          <p className="hint">Campagne aangemaakt (ID: {campaignId}). Voeg eventueel direct een ad group toe.</p>
          <div className="form-row">
            <div><label className="field">Ad group naam</label>
              <input type="text" value={agName} onChange={(e) => setAgName(e.target.value)} placeholder="bijv. DU-Instrumenten" /></div>
            <div><label className="field">Max CPC (€)</label>
              <input type="text" value={agCpc} onChange={(e) => setAgCpc(e.target.value)} /></div>
          </div>
          <div className="form-row">
            <button className="ghost" onClick={onCreated}>Overslaan</button>
            <button className="primary" onClick={createAdGroup} disabled={busy || !agName}>
              {busy ? "Aanmaken…" : "Ad group aanmaken"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
