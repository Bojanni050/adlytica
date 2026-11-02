import React, { useEffect, useState } from "react";
import {
  setAnalyticsConfig, testAnalytics, analyticsLoginStart, analyticsLoginStatus, analyticsLogout,
  setPythonPath, setMistralConfig, getSettingsStatus, SettingsStatus,
  setWordpressConfig, testWordpress, setBrand, BrandConfig,
  getNotifications, setNotifications as saveNotifications, testNotification, setDataForSeo, setPagespeedKey,
  AlertSettings, DEFAULT_ALERT_SETTINGS, setAlertSettings,
  CacheStats, clearAnalyticsCache, getAnalyticsCacheStats,
} from "../lib/api";
import { WHITE_LABEL_ENABLED } from "../lib/features";
import Icon from "../components/Icon";

interface Props {
  accounts: Record<string, string>;
  onAccounts: (a: Record<string, string>) => void;
  brand: BrandConfig | null;
  onBrand: (b: BrandConfig | null) => void;
  /** Geeft de opgeslagen alert-instellingen terug aan App (badge + dashboard). */
  onAlerts: (a: AlertSettings) => void;
}

const DEFAULT_BRAND: BrandConfig = {
  name: "Adlytica",
  accent: "#f59e0b",
  footer: "v0.1.0 — White Vision",
  logo: null,
};

/** Klein getalveld voor de alert-drempels, met eenheid erachter. */
function NumberField({
  label, suffix, value, onChange, disabled, min = 0, step = 1,
}: {
  label: string;
  suffix?: string;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  min?: number;
  step?: number;
}) {
  return (
    <div>
      <label className="field">{label}</label>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input
          type="number"
          min={min}
          step={step}
          value={Number.isFinite(value) ? value : 0}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
          style={{ width: 90 }}
        />
        {suffix && <span className="hint" style={{ margin: 0 }}>{suffix}</span>}
      </div>
    </div>
  );
}

export default function Settings({ accounts, onAccounts, brand, onBrand, onAlerts }: Props) {
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [loginMsg, setLoginMsg] = useState<string | null>(null);
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
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
  const [alertCfg, setAlertCfg] = useState<AlertSettings>(DEFAULT_ALERT_SETTINGS);
  const [alertMsg, setAlertMsg] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [saved, setSaved] = useState<SettingsStatus | null>(null);
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [cacheMsg, setCacheMsg] = useState<string | null>(null);

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
      if (st.analytics_base_url) setBaseUrl(st.analytics_base_url);
      if (st.alerts) setAlertCfg(st.alerts);
    }).catch(() => undefined);
    getNotifications().then(setNotifications).catch(() => undefined);
    getAnalyticsCacheStats().then(setCacheStats).catch(() => undefined);
  }, []);

  async function clearCache() {
    try {
      const cleared = await clearAnalyticsCache();
      setCacheStats(await getAnalyticsCacheStats());
      setCacheMsg(`${cleared} resultaat${cleared === 1 ? "" : "en"} uit de cache gehaald.`);
    } catch (exception) {
      setCacheMsg(String(exception));
    }
  }

  async function save() {
    try {
      if (token.trim() !== "" || baseUrl.trim() !== "") {
        await setAnalyticsConfig(baseUrl.trim(), token.trim(), {
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
      const stored = await setAlertSettings(alertCfg);
      setAlertCfg(stored);
      onAlerts(stored);
      setAlertMsg(
        JSON.stringify(stored) === JSON.stringify(alertCfg)
          ? null
          : "Drempels aangepast: ernst mag nooit eerder afgaan dan een waarschuwing, dus die waarde is gelijkgetrokken."
      );
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

  async function login() {
    setLoginUrl(null);
    setLoginMsg("Bezig met inloggen…");
    try {
      // De URL komt direct terug; daarna pollen we de afloop, zodat niets aan een
      // event of aan een geslaagde browserstart hangt.
      setLoginUrl(await analyticsLoginStart(baseUrl.trim()));
      // De backend wacht 300 s op de callback; net zo lang doorpollen, anders zou
      // de UI het opgeven terwijl de backend de login nog kan afronden.
      for (let i = 0; i < 330; i++) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const status = await analyticsLoginStatus();
        setLoginUrl(status.url || null);
        if (status.phase === "ok" || status.phase === "error") {
          setLoginMsg(status.message);
          if (status.phase === "ok") setSaved(await getSettingsStatus());
          return;
        }
      }
      setLoginMsg("Geen login ontvangen binnen vijf minuten — probeer het opnieuw.");
    } catch (e) {
      setLoginMsg(`✗ ${e}`);
    }
  }

  async function logout() {
    try {
      await analyticsLogout();
      setLoginMsg("Uitgelogd.");
      setSaved(await getSettingsStatus());
    } catch (e) {
      setLoginMsg(`✗ ${e}`);
    }
  }

  async function testDataSource() {
    setTestMsg("Verbinden…");
    try {
      // Eerst opslaan, zodat de test de ingestelde URL en het token gebruikt.
      await setAnalyticsConfig(baseUrl.trim(), token.trim(), {
        searchconsole: gscAccount,
        google_ads: adsAccount,
        googleanalytics4: ga4Account,
      });
      setTestMsg(await testAnalytics());
    } catch (e) {
      setTestMsg(`✗ ${e}`);
    }
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
      <p className="subtitle">Databron (analytics-mcp) en accountconfiguratie</p>

      {status && <div className="card" style={{ marginBottom: 16, borderColor: "var(--accent)" }}>{status}</div>}

      {(loginMsg || loginUrl) && (
        <div className="card" style={{ marginBottom: 16, borderColor: "var(--accent)" }}>
          <strong>Inloggen op de databron</strong>
          {loginMsg && <div style={{ marginTop: 6 }}>{loginMsg}</div>}
          {loginUrl && (
            <>
              <div className="hint" style={{ marginTop: 8 }}>
                Open deze URL in je browser (de login loopt daarna vanzelf af):
              </div>
              <code style={{ display: "block", marginTop: 4, wordBreak: "break-all", userSelect: "all" }}>
                {loginUrl}
              </code>
            </>
          )}
          {saved?.config_path && (
            <div className="hint" style={{ marginTop: 8 }}>
              Logboek met elke stap: {saved.login_log_path ?? saved.config_path.replace(/config\.json$/, "login.log")}
            </div>
          )}
        </div>
      )}
      {saved?.config_path && (
        <p className="hint" style={{ marginBottom: 16 }}>
          Instellingen worden bewaard in: {saved.config_path}
        </p>
      )}

      <div className="card">
        <h3>Databron — analytics-mcp</h3>
        <div className="form-row">
          <div>
            <label className="field">Service-URL</label>
            <input
              type="text" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://analytics.studiovanderheide.nl"
            />
          </div>
        </div>
        <div className="form-row">
          <button className="ghost" type="button" onClick={login}>
            {saved?.analytics_token_set ? "Opnieuw inloggen met Google" : "Inloggen met Google"}
          </button>
          {saved?.analytics_token_set ? (
            <button className="ghost" type="button" onClick={logout}>Uitloggen</button>
          ) : null}
          <button className="ghost" type="button" onClick={testDataSource}>Verbinding testen</button>
          {(loginMsg || testMsg) && (
            <span className="hint" style={{ alignSelf: "center" }}>{loginMsg ?? testMsg}</span>
          )}
        </div>
        <p className="hint">
          De app opent je browser en vangt de login lokaal op; er komt geen sleutel in de app te staan.
          {saved?.analytics_can_refresh
            ? " Het token wordt daarna automatisch vernieuwd."
            : saved?.analytics_token_set
              ? " Vernieuwen kan niet: log in via de knop hierboven."
              : ""}
        </p>

        <div className="form-row">
          <div>
            <label className="field">
              Of plak handmatig een token
              {saved?.analytics_token_set ? " (laat leeg om het huidige te behouden)" : ""}
            </label>
            <input
              type="password" value={token} onChange={(e) => setToken(e.target.value)}
              placeholder={saved?.analytics_token_set ? "•••••••• (opgeslagen)" : "Bearer-token uit de databron"}
            />
          </div>
        </div>
        <p className="hint">
          Eigen analytics-service voor Google Analytics 4, Search Console en Google Ads, onder één
          token. De drie accountvelden hieronder blijven ongewijzigd.
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

        <h3 style={{ marginTop: 20 }}>Querycache</h3>
        <div className="form-row">
          <button className="ghost" type="button" onClick={clearCache}>Cache leegmaken</button>
          <span className="hint" style={{ alignSelf: "center" }}>
            {cacheMsg
              ?? (cacheStats
                ? `${cacheStats.entries} bewaard · ${cacheStats.hits} hergebruikt · ${cacheStats.misses} opgehaald`
                : "Nog niets opgehaald in deze sessie.")}
          </span>
        </div>
        <p className="hint">
          Antwoorden van de databron worden{" "}
          {cacheStats ? Math.round(cacheStats.ttl_seconds / 60) : 5} minuten hergebruikt, zodat
          wisselen tussen views niet elke keer opnieuw hoeft te wachten. Op het dashboard haalt
          "Nu vernieuwen" alles vers op.
        </p>

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
                <span className="brand-logo-empty">
                  <Icon name="panel" size={18} />
                </span>
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

        <h3 style={{ marginTop: 20 }}>Alerts</h3>
        <p className="hint">
          Het dashboard toont maximaal drie signalen: organische klikken die dalen, pagina's met veel
          vertoningen maar een lage CTR, en zoektermen die in positie zakken. Hier stel je in vanaf
          wanneer iets een signaal is. Wijzigingen gaan mee met de knop Opslaan.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 18, marginBottom: 14 }}>
          <label className="field" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 0 }}>
            <input
              type="checkbox"
              checked={alertCfg.enabled}
              onChange={(e) => setAlertCfg({ ...alertCfg, enabled: e.target.checked })}
            />
            Alerts tonen
          </label>
          <label className="field" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 0 }}>
            <input
              type="checkbox"
              checked={alertCfg.badge}
              disabled={!alertCfg.enabled}
              onChange={(e) => setAlertCfg({ ...alertCfg, badge: e.target.checked })}
            />
            Badge in de zijbalk
          </label>
          <label className="field" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 0 }}>
            <input
              type="checkbox"
              checked={alertCfg.notify}
              disabled={!alertCfg.enabled}
              onChange={(e) => setAlertCfg({ ...alertCfg, notify: e.target.checked })}
            />
            Systeemmelding bij signalen
          </label>
        </div>
        <div className="form-row">
          <NumberField
            label="Klikdaling vanaf"
            suffix="%"
            value={alertCfg.clicks_drop_warn_pct}
            disabled={!alertCfg.enabled}
            onChange={(v) => setAlertCfg({ ...alertCfg, clicks_drop_warn_pct: v })}
          />
          <NumberField
            label="Ernstige klikdaling vanaf"
            suffix="%"
            value={alertCfg.clicks_drop_high_pct}
            disabled={!alertCfg.enabled}
            onChange={(v) => setAlertCfg({ ...alertCfg, clicks_drop_high_pct: v })}
          />
          <NumberField
            label="Minimaal klikken vorige periode"
            value={alertCfg.min_clicks_previous}
            disabled={!alertCfg.enabled}
            onChange={(v) => setAlertCfg({ ...alertCfg, min_clicks_previous: v })}
          />
        </div>
        <div className="form-row">
          <NumberField
            label="CTR-alert vanaf vertoningen"
            value={alertCfg.min_page_impressions}
            disabled={!alertCfg.enabled}
            onChange={(v) => setAlertCfg({ ...alertCfg, min_page_impressions: v })}
          />
          <NumberField
            label="Lage CTR onder"
            suffix="%"
            step={0.1}
            value={alertCfg.max_page_ctr_pct}
            disabled={!alertCfg.enabled}
            onChange={(v) => setAlertCfg({ ...alertCfg, max_page_ctr_pct: v })}
          />
          <NumberField
            label="Minimaal vertoningen zoekterm"
            value={alertCfg.min_query_impressions}
            disabled={!alertCfg.enabled}
            onChange={(v) => setAlertCfg({ ...alertCfg, min_query_impressions: v })}
          />
        </div>
        <div className="form-row">
          <NumberField
            label="Positiedaling vanaf"
            suffix="plaatsen"
            step={0.5}
            value={alertCfg.position_drop_warn}
            disabled={!alertCfg.enabled}
            onChange={(v) => setAlertCfg({ ...alertCfg, position_drop_warn: v })}
          />
          <NumberField
            label="Ernstige positiedaling vanaf"
            suffix="plaatsen"
            step={0.5}
            value={alertCfg.position_drop_high}
            disabled={!alertCfg.enabled}
            onChange={(v) => setAlertCfg({ ...alertCfg, position_drop_high: v })}
          />
          <div />
        </div>
        {alertMsg && <p className="hint" style={{ color: "var(--warn)" }}>{alertMsg}</p>}
        {!notifications && alertCfg.notify && (
          <p className="hint">
            Systeemmeldingen staan nog uit bij Meldingen hierboven; zonder die schakelaar blijft het stil.
          </p>
        )}

        <div style={{ marginTop: 20 }}>
          <button className="primary" onClick={save}>Opslaan</button>
        </div>
      </div>
    </div>
  );
}
