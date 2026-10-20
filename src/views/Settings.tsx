import React, { useEffect, useState } from "react";
import {
  setWindsorKey, setPythonPath, setMistralConfig, getSettingsStatus, SettingsStatus,
  setWordpressConfig, testWordpress, setBrand, BrandConfig,
  getNotifications, setNotifications as saveNotifications, testNotification, setDataForSeo, setPagespeedKey,
} from "../lib/api";
import { WHITE_LABEL_ENABLED } from "../lib/features";

interface Props {
  accounts: Record<string, string>;
  onAccounts: (a: Record<string, string>) => void;
  brand: BrandConfig | null;
  onBrand: (b: BrandConfig | null) => void;
}

const DEFAULT_BRAND: BrandConfig = {
  name: "Adlytica",
  accent: "#f59e0b",
  footer: "v0.1.0 — White Vision",
  logo: null,
};

export default function Settings({ accounts, onAccounts, brand, onBrand }: Props) {
  const [apiKey, setApiKey] = useState("");
  const [gscAccount, setGscAccount] = useState(accounts.searchconsole ?? "");
  const [adsAccount, setAdsAccount] = useState(accounts.google_ads ?? "");
  const [ga4Account, setGa4Account] = useState(accounts.googleanalytics4 ?? "");
  const [pythonPath, setPythonPath] = useState("python3");
  const [mistralKey, setMistralKey] = useState("");
  const [mistralModel, setMistralModel] = useState("mistral-small-latest");
  const [wpUrl, setWpUrl] = useState("");
  const [wpUser, setWpUser] = useState("");
  const [wpPassword, setWpPassword] = useState("");
  const [wpTest, setWpTest] = useState<string | null>(null);
  const [brandName, setBrandName] = useState(brand?.name ?? DEFAULT_BRAND.name);
  const [brandAccent, setBrandAccent] = useState(brand?.accent ?? DEFAULT_BRAND.accent);
  const [brandFooter, setBrandFooter] = useState(brand?.footer ?? DEFAULT_BRAND.footer);
  const [brandLogo, setBrandLogo] = useState<string | null>(brand?.logo ?? null);
  const [brandMsg, setBrandMsg] = useState<string | null>(null);
  const [psKey, setPsKey] = useState("");
  const [dfLogin, setDfLogin] = useState("");
  const [dfPassword, setDfPassword] = useState("");
  const [notifications, setNotifications] = useState(false);
  const [notifyMsg, setNotifyMsg] = useState<string | null>(null);
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
      if (st.wp_url) setWpUrl(st.wp_url);
      if (st.wp_user) setWpUser(st.wp_user);
    }).catch(() => undefined);
    getNotifications().then(setNotifications).catch(() => undefined);
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
      await setWordpressConfig(wpUrl.trim(), wpUser.trim(), wpPassword.trim());
      if (psKey.trim() !== "") await setPagespeedKey(psKey.trim());
      if (dfLogin.trim() !== "" || dfPassword.trim() !== "") {
        await setDataForSeo(dfLogin.trim(), dfPassword.trim());
      }
      await saveNotifications(notifications);
      const nextBrand: BrandConfig = {
        name: brandName.trim() || DEFAULT_BRAND.name,
        accent: brandAccent,
        footer: brandFooter.trim() || DEFAULT_BRAND.footer,
        logo: brandLogo,
      };
      if (WHITE_LABEL_ENABLED) {
        await setBrand(nextBrand);
        onBrand(nextBrand);
      }
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

  function pickLogo(file: File | undefined) {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type)) {
      setBrandMsg("Kies een png-, jpg-, webp- of svg-bestand.");
      return;
    }
    if (file.size > 400_000) {
      setBrandMsg("Het logo is groter dan 400 kB. Verklein het bestand eerst.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setBrandLogo(String(reader.result ?? ""));
      setBrandMsg(null);
    };
    reader.onerror = () => setBrandMsg("Het bestand kon niet worden gelezen.");
    reader.readAsDataURL(file);
  }

  async function testWp() {
    setWpTest("Verbinden…");
    try {
      // Eerst opslaan, zodat de test met de ingevulde gegevens werkt.
      await setWordpressConfig(wpUrl.trim(), wpUser.trim(), wpPassword.trim());
      const name = await testWordpress();
      setWpTest(`✓ Verbonden met ${name}`);
    } catch (e) {
      setWpTest(`✗ ${e}`);
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

        <h3 style={{ marginTop: 20 }}>WordPress (Rank Math)</h3>
        <div className="form-row">
          <div>
            <label className="field">Site-URL</label>
            <input
              type="text" value={wpUrl} onChange={(e) => setWpUrl(e.target.value)}
              placeholder="https://white-vision.nl"
            />
          </div>
        </div>
        <div className="form-row">
          <div>
            <label className="field">Gebruikersnaam</label>
            <input
              type="text" value={wpUser} onChange={(e) => setWpUser(e.target.value)}
              placeholder="WordPress-gebruikersnaam (niet je e-mailadres)"
            />
          </div>
          <div>
            <label className="field">
              Applicatiewachtwoord {saved?.wp_password_set ? "— ✓ opgeslagen (laat leeg om te behouden)" : ""}
            </label>
            <input
              type="password" value={wpPassword} onChange={(e) => setWpPassword(e.target.value)}
              placeholder={saved?.wp_password_set ? "•••••••• (opgeslagen)" : "xxxx xxxx xxxx xxxx"}
            />
          </div>
        </div>
        <p className="hint">
          Maak een applicatiewachtwoord aan in WordPress onder Gebruikers → Profiel →
          Applicatiewachtwoorden. Daarmee kan Adlytica Rank Math-titels en -omschrijvingen van
          pagina's aanpassen, zonder je gewone wachtwoord te gebruiken. De gegevens blijven lokaal
          in de app.
        </p>
        <div className="form-row">
          <button className="ghost" onClick={testWp}>Verbinding testen</button>
          {wpTest && <span className="hint" style={{ alignSelf: "center" }}>{wpTest}</span>}
        </div>

        <h3 style={{ marginTop: 20 }}>PageSpeed</h3>
        <div className="form-row">
          <div>
            <label className="field">Google API-key</label>
            <input
              type="password"
              value={psKey}
              onChange={(e) => setPsKey(e.target.value)}
              placeholder={saved?.pagespeed_key_set ? "opgeslagen" : "AIza…"}
            />
          </div>
        </div>
        <p className="hint">
          Gratis key via de Google Cloud-console: PageSpeed Insights API aanzetten en een API-key
          maken. Zonder key blijft de view Snelheid leeg.
        </p>

        {WHITE_LABEL_ENABLED && (
          <>
        <h3 style={{ marginTop: 20 }}>Wit-label</h3>
        <div className="form-row">
          <div>
            <label className="field">App-naam</label>
            <input type="text" value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder="Adlytica" />
          </div>
          <div>
            <label className="field">Accentkleur</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="color" value={brandAccent} onChange={(e) => setBrandAccent(e.target.value)}
                style={{ width: 44, height: 34, padding: 2, background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 8 }}
              />
              <input type="text" value={brandAccent} onChange={(e) => setBrandAccent(e.target.value)} style={{ width: 110 }} />
            </div>
          </div>
        </div>
        <div className="form-row">
          <div>
            <label className="field">Voettekst in de zijbalk</label>
            <input type="text" value={brandFooter} onChange={(e) => setBrandFooter(e.target.value)} />
          </div>
        </div>
        <div className="form-row">
          <div>
            <label className="field">Logo</label>
            <div className="brand-logo-row">
              {brandLogo ? (
                <img className="brand-logo-preview" src={brandLogo} alt="Logo" />
              ) : (
                <span className="brand-logo-empty">◉</span>
              )}
              <label className="ghost brand-logo-pick">
                Bestand kiezen
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  onChange={(e) => pickLogo(e.target.files?.[0])}
                  style={{ display: "none" }}
                />
              </label>
              {brandLogo && (
                <button className="ghost" type="button" onClick={() => setBrandLogo(null)}>
                  Verwijderen
                </button>
              )}
            </div>
          </div>
        </div>
        <p className="hint">
          png, jpg, webp of svg, maximaal 400 kB. Het logo wordt als data-URL in de configuratie
          bewaard en verschijnt in de zijbalk. De accentkleur geldt voor knoppen, menu en randen;
          de grafiekreeksen houden hun eigen palet.
        </p>
        {brandMsg && <p className="hint" style={{ color: "var(--danger)" }}>{brandMsg}</p>}
          </>
        )}

        <h3 style={{ marginTop: 20 }}>DataForSEO</h3>
        <div className="form-row">
          <div>
            <label className="field">Login (e-mailadres)</label>
            <input
              type="text"
              value={dfLogin}
              onChange={(e) => setDfLogin(e.target.value)}
              placeholder={saved?.dataforseo_set ? "opgeslagen" : "naam@voorbeeld.nl"}
            />
          </div>
          <div>
            <label className="field">Wachtwoord</label>
            <input
              type="password"
              value={dfPassword}
              onChange={(e) => setDfPassword(e.target.value)}
              placeholder={saved?.dataforseo_set ? "opgeslagen" : "API-wachtwoord"}
            />
          </div>
        </div>
        <p className="hint">
          Alleen nodig voor de concurrent-analyse. DataForSEO werkt pay-as-you-go: ongeveer $0,012
          per taak plus $0,00012 per keyword (minimaal $50 tegoed). Zonder deze gegevens blijft de
          view Concurrenten uit.
        </p>

        <h3 style={{ marginTop: 20 }}>Meldingen</h3>
        <div className="form-row">
          <div>
            <label className="field" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={notifications}
                onChange={(e) => setNotifications(e.target.checked)}
              />
              Windows-meldingen tonen
            </label>
          </div>
        </div>
        <p className="hint">
          Je krijgt één melding per dag als er pagina's of zoektermen zijn die week-op-week 30% of
          meer zijn gezakt. De melding verschijnt ook als Adlytica op de achtergrond staat.
        </p>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button
            className="ghost"
            type="button"
            onClick={async () => {
              try {
                await testNotification();
                setNotifyMsg("Testmelding verstuurd.");
              } catch (e) {
                setNotifyMsg(`Fout: ${e}`);
              }
            }}
          >
            Testmelding
          </button>
          {notifyMsg && <span className="hint" style={{ margin: 0 }}>{notifyMsg}</span>}
        </div>

        <div style={{ marginTop: 20 }}>
          <button className="primary" onClick={save}>Opslaan</button>
        </div>
      </div>
    </div>
  );
}
