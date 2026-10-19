import React, { useEffect, useState } from "react";
import { setWindsorKey, setPythonPath, setMistralConfig, getSettingsStatus, SettingsStatus } from "../lib/api";

interface Props {
  accounts: Record<string, string>;
  onAccounts: (a: Record<string, string>) => void;
}

export default function Settings({ accounts, onAccounts }: Props) {
  const [apiKey, setApiKey] = useState("");
  const [gscAccount, setGscAccount] = useState(accounts.searchconsole ?? "");
  const [adsAccount, setAdsAccount] = useState(accounts.google_ads ?? "");
  const [ga4Account, setGa4Account] = useState(accounts.googleanalytics4 ?? "");
  const [pythonPath, setPythonPath] = useState("python3");
  const [mistralKey, setMistralKey] = useState("");
  const [mistralModel, setMistralModel] = useState("mistral-small-latest");
  const [status, setStatus] = useState<string | null>(null);
  const [saved, setSaved] = useState<SettingsStatus | null>(null);

  useEffect(() => {
    getSettingsStatus().then((st) => {
      setSaved(st);
      if (st.accounts.searchconsole) setGscAccount(st.accounts.searchconsole);
      if (st.accounts.google_ads) setAdsAccount(st.accounts.google_ads);
      if (st.accounts.googleanalytics4) setGa4Account(st.accounts.googleanalytics4);
      setMistralModel(st.mistral_model);
      setPythonPath(st.python_path);
    }).catch(() => undefined);
  }, []);

  async function save() {
    try {
      if (apiKey.trim() !== "") {
        await setWindsorKey(apiKey.trim(), {
          searchconsole: gscAccount,
          google_ads: adsAccount,
          googleanalytics4: ga4Account,
        });
      }
      await setPythonPath(pythonPath);
      await setMistralConfig(mistralKey.trim(), mistralModel);
      onAccounts({
        searchconsole: gscAccount,
        google_ads: adsAccount,
        googleanalytics4: ga4Account,
      });
      setStatus("Instellingen opgeslagen.");
    } catch (e) {
      setStatus(`Fout: ${e}`);
    }
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <h1>Instellingen</h1>
      <p className="subtitle">Windsor.ai en accountconfiguratie</p>

      {status && <div className="card" style={{ marginBottom: 16, borderColor: "var(--accent)" }}>{status}</div>}
      {saved?.config_path && (
        <p className="hint" style={{ marginBottom: 16 }}>
          Instellingen worden bewaard in: {saved.config_path}
        </p>
      )}

      <div className="card">
        <h3>Windsor.ai API</h3>
        <div className="form-row">
          <div>
            <label className="field">
              API-key {saved?.windsor_key_set ? "— ✓ opgeslagen (laat leeg om te behouden)" : ""}
            </label>
            <input
              type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
              placeholder={saved?.windsor_key_set ? "•••••••• (opgeslagen)" : "Voer je API-key in"}
            />
          </div>
        </div>
        <p className="hint">
          Vind je API-key in Windsor.ai onder Settings → API. De sleutel wordt lokaal in de app bewaard.
        </p>

        <div className="form-row">
          <div>
            <label className="field">Search Console account (site-URL)</label>
            <input type="text" value={gscAccount} onChange={(e) => setGscAccount(e.target.value)} />
          </div>
        </div>
        <div className="form-row">
          <div>
            <label className="field">Google Ads account (ID)</label>
            <input type="text" value={adsAccount} onChange={(e) => setAdsAccount(e.target.value)} />
          </div>
        </div>
        <div className="form-row">
          <div>
            <label className="field">Google Analytics 4 account (ID)</label>
            <input type="text" value={ga4Account} onChange={(e) => setGa4Account(e.target.value)} />
          </div>
        </div>

        <h3 style={{ marginTop: 20 }}>Adly (AI-assistent)</h3>
        <div className="form-row">
          <div>
            <label className="field">
              Mistral API-key {saved?.mistral_key_set ? "— ✓ opgeslagen (laat leeg om te behouden)" : ""}
            </label>
            <input
              type="password" value={mistralKey} onChange={(e) => setMistralKey(e.target.value)}
              placeholder={saved?.mistral_key_set ? "•••••••• (opgeslagen)" : "Voer je API-key in"}
            />
          </div>
          <div>
            <label className="field">Model</label>
            <select value={mistralModel} onChange={(e) => setMistralModel(e.target.value)}>
              <option value="mistral-small-latest">Mistral Small (snel, voordelig)</option>
              <option value="mistral-medium-latest">Mistral Medium</option>
              <option value="mistral-large-latest">Mistral Large (beste kwaliteit)</option>
            </select>
          </div>
        </div>
        <p className="hint">
          Maak een API-key aan op console.mistral.ai. De sleutel blijft lokaal in de app.
        </p>

        <h3 style={{ marginTop: 20 }}>Google Trends</h3>
        <div className="form-row">
          <div>
            <label className="field">Python-executable (voor pytrends sidecar)</label>
            <input type="text" value={pythonPath} onChange={(e) => setPythonPath(e.target.value)} />
          </div>
        </div>
        <p className="hint">
          Installeer eerst: <code>pip install pytrends</code>
        </p>

        <div style={{ marginTop: 20 }}>
          <button className="primary" onClick={save}>Opslaan</button>
        </div>
      </div>
    </div>
  );
}
