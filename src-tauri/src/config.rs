use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppConfig {
    // Elk veld is `default`, zodat een bestaand config.json zonder nieuw veld
    // niet de hele configuratie (inclusief API-keys) op default zet.
    /// Basis-URL van de self-hosted analytics-service (GA4, Search Console, Ads).
    #[serde(default)]
    pub analytics_base_url: Option<String>,
    /// Bearer-token uit de Google-login van die service.
    #[serde(default)]
    pub analytics_access_token: Option<String>,
    /// Refresh-token, zodat de app na het verlopen van het access-token zelf kan verversen.
    #[serde(default)]
    pub analytics_refresh_token: Option<String>,
    /// Client-id uit de dynamische registratie (DCR) bij de service.
    #[serde(default)]
    pub analytics_client_id: Option<String>,
    #[serde(default)]
    pub mistral_api_key: Option<String>,
    #[serde(default = "default_mistral_model")]
    pub mistral_model: String,
    #[serde(default)]
    pub accounts: HashMap<String, String>,
    #[serde(default = "default_python_path")]
    pub python_path: String,
    /// Volgorde en verborgen widgets van het dashboard, zoals de frontend ze aanlevert.
    #[serde(default)]
    pub dashboard_layout: Option<serde_json::Value>,
    /// Windows-meldingen aan of uit (instelbaar bij Instellingen).
    #[serde(default)]
    pub notifications_enabled: bool,
    /// DataForSEO-login en -wachtwoord (betaald, optioneel).
    #[serde(default)]
    pub dataforseo_login: Option<String>,
    #[serde(default)]
    pub dataforseo_password: Option<String>,
    /// WordPress-site voor de Rank Math-koppeling, bijv. https://white-vision.nl.
    #[serde(default)]
    pub wp_url: Option<String>,
    #[serde(default)]
    pub wp_user: Option<String>,
    #[serde(default)]
    pub wp_app_password: Option<String>,
    /// Google API-key voor PageSpeed Insights (gratis, met dagquotum).
    #[serde(default)]
    pub pagespeed_api_key: Option<String>,
    /// Wit-label: app-naam, accentkleur, voettekst en logo (data-URL).
    #[serde(default)]
    pub brand: Option<serde_json::Value>,
    /// Drempels en schakelaars voor de dashboard-alerts.
    #[serde(default)]
    pub alerts: AlertSettings,
    /// Taken uit het actiecentrum (dashboard-signalen en handmatige taken).
    #[serde(default)]
    pub actions: Vec<ActionItem>,
    /// Bevroren rapporten: de cijfers zoals ze op het moment van bewaren waren.
    #[serde(default)]
    pub reports: Vec<ReportSnapshot>,
}

/// Instelbare drempels voor de drie dashboard-alerts.
///
/// Bewust platte velden: de frontend spiegelt dit type één op één, dus een
/// geneste struct zou alleen maar extra heen-en-weer werk kosten.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct AlertSettings {
    /// Hoofdschakelaar: geen alerts, geen badge, geen meldingen.
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Aantal alerts als badge in de zijbalk bij Dashboard.
    #[serde(default = "default_true")]
    pub badge: bool,
    /// Windows-melding sturen als er alerts zijn (maximaal één per dag).
    #[serde(default)]
    pub notify: bool,
    /// Klikdaling vanaf dit percentage is een alert.
    #[serde(default = "default_clicks_warn")]
    pub clicks_drop_warn_pct: f64,
    /// Klikdaling vanaf dit percentage is een ernstige alert.
    #[serde(default = "default_clicks_high")]
    pub clicks_drop_high_pct: f64,
    /// Onder dit aantal klikken in de vorige periode geen klik-alert (te ruisgevoelig).
    #[serde(default = "default_min_clicks")]
    pub min_clicks_previous: f64,
    /// Pagina's onder dit aantal vertoningen doen niet mee aan de CTR-alert.
    #[serde(default = "default_min_page_impressions")]
    pub min_page_impressions: f64,
    /// Pagina's met een CTR onder dit percentage (en genoeg vertoningen) krijgen een alert.
    #[serde(default = "default_max_page_ctr")]
    pub max_page_ctr_pct: f64,
    /// Zoektermen onder dit aantal vertoningen doen niet mee aan de positie-alert.
    #[serde(default = "default_min_query_impressions")]
    pub min_query_impressions: f64,
    /// Positiedaling vanaf dit aantal plaatsen is een alert.
    #[serde(default = "default_position_warn")]
    pub position_drop_warn: f64,
    /// Positiedaling vanaf dit aantal plaatsen is een ernstige alert.
    #[serde(default = "default_position_high")]
    pub position_drop_high: f64,
}

fn default_true() -> bool {
    true
}
fn default_clicks_warn() -> f64 {
    15.0
}
fn default_clicks_high() -> f64 {
    30.0
}
fn default_min_clicks() -> f64 {
    100.0
}
fn default_min_page_impressions() -> f64 {
    1000.0
}
fn default_max_page_ctr() -> f64 {
    1.0
}
fn default_min_query_impressions() -> f64 {
    100.0
}
fn default_position_warn() -> f64 {
    2.0
}
fn default_position_high() -> f64 {
    5.0
}

impl Default for AlertSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            badge: true,
            notify: false,
            clicks_drop_warn_pct: default_clicks_warn(),
            clicks_drop_high_pct: default_clicks_high(),
            min_clicks_previous: default_min_clicks(),
            min_page_impressions: default_min_page_impressions(),
            max_page_ctr_pct: default_max_page_ctr(),
            min_query_impressions: default_min_query_impressions(),
            position_drop_warn: default_position_warn(),
            position_drop_high: default_position_high(),
        }
    }
}

impl AlertSettings {
    /// Maakt van willekeurige invoer (uit de UI of een handmatig bewerkt
    /// config.json) weer bruikbare drempels: percentages binnen 0–100,
    /// aantallen niet negatief en "ernstig" nooit strenger dan "waarschuwing".
    pub fn sanitized(mut self) -> Self {
        fn clamp(value: f64, min: f64, max: f64) -> f64 {
            if value.is_finite() {
                value.clamp(min, max)
            } else {
                min
            }
        }

        self.clicks_drop_warn_pct = clamp(self.clicks_drop_warn_pct, 0.0, 100.0);
        self.clicks_drop_high_pct = clamp(self.clicks_drop_high_pct, 0.0, 100.0);
        self.min_clicks_previous = clamp(self.min_clicks_previous, 0.0, 1_000_000.0);
        self.min_page_impressions = clamp(self.min_page_impressions, 0.0, 1_000_000.0);
        self.max_page_ctr_pct = clamp(self.max_page_ctr_pct, 0.0, 100.0);
        self.min_query_impressions = clamp(self.min_query_impressions, 0.0, 1_000_000.0);
        self.position_drop_warn = clamp(self.position_drop_warn, 0.0, 100.0);
        self.position_drop_high = clamp(self.position_drop_high, 0.0, 100.0);

        if self.clicks_drop_high_pct < self.clicks_drop_warn_pct {
            self.clicks_drop_high_pct = self.clicks_drop_warn_pct;
        }
        if self.position_drop_high < self.position_drop_warn {
            self.position_drop_high = self.position_drop_warn;
        }
        self
    }
}

/// Eén taak in het actiecentrum. Bewust plat en zonder logica: de frontend
/// bepaalt wat er in komt, de backend bewaart het netjes en schoont het op.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct ActionItem {
    /// Uniek binnen de lijst; de frontend genereert hem.
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub detail: String,
    /// "nieuw", "gezien", "uitgevoerd" of "genegeerd".
    #[serde(default = "default_action_status")]
    pub status: String,
    /// "alert" (uit een dashboardsignaal) of "handmatig".
    #[serde(default = "default_action_source")]
    pub source: String,
    /// Herkenningssleutel van de alert waaruit de taak ontstond.
    #[serde(default)]
    pub alert_key: Option<String>,
    /// View waarnaar de taak verwijst (bijv. "seo").
    #[serde(default)]
    pub view: Option<String>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

fn default_action_status() -> String {
    "nieuw".into()
}

fn default_action_source() -> String {
    "handmatig".into()
}

pub const ACTION_STATUSES: [&str; 4] = ["nieuw", "gezien", "uitgevoerd", "genegeerd"];
const MAX_ACTIONS: usize = 500;

/// Maakt van willekeurige invoer een bruikbare takenlijst: geen lege titels,
/// alleen bekende statussen en een harde bovengrens zodat config.json niet groeit
/// zonder einde. Onbekende statussen vallen terug op "nieuw" in plaats van de
/// hele taak te laten verdwijnen.
pub fn sanitized_actions(actions: Vec<ActionItem>) -> Vec<ActionItem> {
    fn trim_to(value: &str, max: usize) -> String {
        let trimmed = value.trim();
        trimmed.chars().take(max).collect()
    }

    actions
        .into_iter()
        .filter_map(|mut action| {
            action.id = trim_to(&action.id, 64);
            action.title = trim_to(&action.title, 200);
            if action.id.is_empty() || action.title.is_empty() {
                return None;
            }
            action.detail = trim_to(&action.detail, 2000);
            if !ACTION_STATUSES.contains(&action.status.as_str()) {
                action.status = "nieuw".into();
            }
            action.source = if action.source == "alert" { "alert".into() } else { "handmatig".into() };
            action.alert_key = action.alert_key.map(|key| trim_to(&key, 200)).filter(|key| !key.is_empty());
            action.view = action.view.map(|view| trim_to(&view, 40)).filter(|view| !view.is_empty());
            action.created_at = trim_to(&action.created_at, 40);
            action.updated_at = trim_to(&action.updated_at, 40);
            Some(action)
        })
        .take(MAX_ACTIONS)
        .collect()
}

/// Eén bevroren rapport. De waarden staan als tekst in de snapshot, precies
/// zoals ze in de PDF belandden: een later bijgewerkte databron mag een
/// verstuurd rapport niet meer veranderen.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct ReportSnapshot {
    /// Uniek binnen de lijst; de frontend genereert hem.
    pub id: String,
    pub title: String,
    /// Moment van bewaren (ISO-8601).
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub date_from: String,
    #[serde(default)]
    pub date_to: String,
    /// Lengte van de periode in dagen, voor "laatste 90 dagen" in de kop.
    #[serde(default)]
    pub days: u32,
    #[serde(default)]
    pub kpis: Vec<SnapshotKpi>,
    #[serde(default)]
    pub sections: Vec<SnapshotSection>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct SnapshotKpi {
    pub label: String,
    pub value: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct SnapshotSection {
    pub title: String,
    #[serde(default)]
    pub head: Vec<String>,
    #[serde(default)]
    pub rows: Vec<Vec<String>>,
    #[serde(default)]
    pub note: Option<String>,
}

const MAX_REPORTS: usize = 100;
const MAX_SNAPSHOT_ROWS: usize = 500;

/// Houdt snapshots klein en voorspelbaar. Een rapport zonder titel of zonder
/// inhoud verdwijnt; alles wat te lang is wordt afgekapt in plaats van de
/// hele snapshot te weigeren.
pub fn sanitized_reports(reports: Vec<ReportSnapshot>) -> Vec<ReportSnapshot> {
    fn trim_to(value: &str, max: usize) -> String {
        value.trim().chars().take(max).collect()
    }
    fn trim_cells(cells: Vec<String>, max_cells: usize) -> Vec<String> {
        cells.into_iter().take(max_cells).map(|cell| trim_to(&cell, 200)).collect()
    }

    reports
        .into_iter()
        .filter_map(|mut report| {
            report.id = trim_to(&report.id, 64);
            report.title = trim_to(&report.title, 200);
            if report.id.is_empty() || report.title.is_empty() {
                return None;
            }
            report.created_at = trim_to(&report.created_at, 40);
            report.date_from = trim_to(&report.date_from, 20);
            report.date_to = trim_to(&report.date_to, 20);
            report.days = report.days.min(36_500);

            report.kpis = report
                .kpis
                .into_iter()
                .take(20)
                .map(|kpi| SnapshotKpi {
                    label: trim_to(&kpi.label, 80),
                    value: trim_to(&kpi.value, 80),
                })
                .collect();

            report.sections = report
                .sections
                .into_iter()
                .filter_map(|section| {
                    let title = trim_to(&section.title, 120);
                    if title.is_empty() {
                        return None;
                    }
                    Some(SnapshotSection {
                        title,
                        head: section.head.into_iter().take(12).map(|cell| trim_to(&cell, 60)).collect(),
                        rows: section
                            .rows
                            .into_iter()
                            .take(MAX_SNAPSHOT_ROWS)
                            .map(|row| trim_cells(row, 12))
                            .collect(),
                        note: section.note.map(|note| trim_to(&note, 500)).filter(|note| !note.is_empty()),
                    })
                })
                .collect();

            if report.kpis.is_empty() && report.sections.is_empty() {
                return None;
            }
            Some(report)
        })
        .take(MAX_REPORTS)
        .collect()
}

fn default_mistral_model() -> String {
    "mistral-small-latest".into()
}

fn default_python_path() -> String {
    "python3".into()
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            analytics_base_url: None,
            analytics_access_token: None,
            analytics_refresh_token: None,
            analytics_client_id: None,
            mistral_api_key: None,
            mistral_model: default_mistral_model(),
            accounts: HashMap::new(),
            python_path: default_python_path(),
            dashboard_layout: None,
            notifications_enabled: false,
            dataforseo_login: None,
            dataforseo_password: None,
            wp_url: None,
            wp_user: None,
            wp_app_password: None,
            pagespeed_api_key: None,
            brand: None,
            alerts: AlertSettings::default(),
            actions: Vec::new(),
            reports: Vec::new(),
        }
    }
}

pub fn config_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("APPDATA").map(|d| PathBuf::from(d).join("adlytica"))
    }
    #[cfg(target_os = "macos")]
    {
        std::env::var_os("HOME").map(|h| {
            PathBuf::from(h)
                .join("Library")
                .join("Application Support")
                .join("adlytica")
        })
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
            .map(|d| d.join("adlytica"))
    }
}

pub fn config_path() -> Option<PathBuf> {
    config_dir().map(|d| d.join("config.json"))
}

pub fn load() -> AppConfig {
    let Some(path) = config_path() else {
        return AppConfig::default();
    };
    match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
        Err(_) => AppConfig::default(),
    }
}

pub fn save(config: &AppConfig) -> Result<(), String> {
    let Some(dir) = config_dir() else {
        return Err("Kon configuratiemap niet bepalen".into());
    };
    std::fs::create_dir_all(&dir).map_err(|e| format!("Kon configuratiemap niet aanmaken: {e}"))?;
    let path = dir.join("config.json");
    let text = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    std::fs::write(&path, text).map_err(|e| format!("Kon configuratie niet opslaan: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_van_voor_de_databronwissel_blijft_geldig() {
        // Een bestaand config.json met het oude windsor_api_key-veld mag niet op default
        // vallen, anders raken accounts en andere sleutels kwijt. Het onbekende veld
        // wordt genegeerd.
        let text = r#"{"windsor_api_key":"w","mistral_api_key":"m","mistral_model":"mistral-small-latest","accounts":{"searchconsole":"acc"},"python_path":"python3"}"#;
        let cfg: AppConfig = serde_json::from_str(text).expect("bestaande config moet leesbaar blijven");
        assert_eq!(cfg.mistral_api_key.as_deref(), Some("m"));
        assert!(cfg.analytics_access_token.is_none());
        assert_eq!(cfg.accounts.get("searchconsole").map(String::as_str), Some("acc"));
        assert!(cfg.dashboard_layout.is_none());
    }

    #[test]
    fn databron_instellingen_blijven_bewaard() {
        let cfg = AppConfig {
            analytics_base_url: Some("https://analytics.studiovanderheide.nl".into()),
            analytics_access_token: Some("tok".into()),
            analytics_refresh_token: Some("refresh".into()),
            analytics_client_id: Some("client".into()),
            ..AppConfig::default()
        };
        let back: AppConfig = serde_json::from_str(&serde_json::to_string(&cfg).unwrap()).unwrap();
        assert_eq!(
            back.analytics_base_url.as_deref(),
            Some("https://analytics.studiovanderheide.nl")
        );
        assert_eq!(back.analytics_access_token.as_deref(), Some("tok"));
        assert_eq!(back.analytics_refresh_token.as_deref(), Some("refresh"));
        assert_eq!(back.analytics_client_id.as_deref(), Some("client"));
    }

    #[test]
    fn dashboard_layout_blijft_bewaard() {
        let cfg = AppConfig {
            dashboard_layout: Some(serde_json::json!({ "order": ["a", "b"], "hidden": ["b"] })),
            ..AppConfig::default()
        };
        let text = serde_json::to_string(&cfg).unwrap();
        let back: AppConfig = serde_json::from_str(&text).unwrap();
        let layout = back.dashboard_layout.expect("layout moet terugkomen");
        assert_eq!(layout["hidden"][0], "b");
        assert_eq!(layout["order"][1], "b");
    }

    #[test]
    fn config_zonder_alerts_krijgt_de_defaults() {
        // Bestaande config.json heeft geen "alerts"; de app moet dan de
        // standaarddrempels gebruiken in plaats van alles op nul te zetten.
        let text = r#"{"mistral_model":"mistral-small-latest","notifications_enabled":true}"#;
        let cfg: AppConfig = serde_json::from_str(text).expect("oude config moet leesbaar blijven");
        assert!(cfg.alerts.enabled);
        assert!(cfg.alerts.badge);
        assert!(!cfg.alerts.notify);
        assert_eq!(cfg.alerts.clicks_drop_warn_pct, 15.0);
        assert_eq!(cfg.alerts.position_drop_high, 5.0);
    }

    #[test]
    fn alert_drempels_worden_opgeschoond() {
        let opgeschoond = AlertSettings {
            clicks_drop_warn_pct: 70.0,
            clicks_drop_high_pct: 10.0,
            max_page_ctr_pct: -3.0,
            min_page_impressions: -1.0,
            position_drop_warn: 4.0,
            position_drop_high: 1.0,
            ..AlertSettings::default()
        }
        .sanitized();
        // "Ernstig" mag nooit eerder afgaan dan "waarschuwing".
        assert_eq!(opgeschoond.clicks_drop_high_pct, 70.0);
        assert_eq!(opgeschoond.position_drop_high, 4.0);
        assert_eq!(opgeschoond.max_page_ctr_pct, 0.0);
        assert_eq!(opgeschoond.min_page_impressions, 0.0);
    }

    #[test]
    fn takenlijst_wordt_opgeschoond() {
        let opgeschoond = sanitized_actions(vec![
            ActionItem {
                id: "a".into(),
                title: "  Titel  ".into(),
                detail: "detail".into(),
                status: "bestaat-niet".into(),
                source: "alert".into(),
                alert_key: Some("  clicks-drop|Titel ".into()),
                view: Some("seo".into()),
                created_at: "2026-11-01T10:00:00Z".into(),
                updated_at: "2026-11-01T10:00:00Z".into(),
            },
            ActionItem {
                id: "b".into(),
                title: "   ".into(),
                detail: String::new(),
                status: "nieuw".into(),
                source: "handmatig".into(),
                alert_key: None,
                view: None,
                created_at: String::new(),
                updated_at: String::new(),
            },
        ]);
        assert_eq!(opgeschoond.len(), 1, "taak zonder titel hoort te vervallen");
        assert_eq!(opgeschoond[0].title, "Titel");
        assert_eq!(opgeschoond[0].status, "nieuw");
        assert_eq!(opgeschoond[0].alert_key.as_deref(), Some("clicks-drop|Titel"));
    }

    #[test]
    fn config_zonder_actions_krijgt_een_lege_lijst() {
        let text = r#"{"mistral_model":"mistral-small-latest"}"#;
        let cfg: AppConfig = serde_json::from_str(text).expect("oude config moet leesbaar blijven");
        assert!(cfg.actions.is_empty());
        assert!(cfg.reports.is_empty());
    }

    #[test]
    fn snapshots_worden_opgeschoond() {
        let opgeschoond = sanitized_reports(vec![
            ReportSnapshot {
                id: "r1".into(),
                title: "  SEO-rapport  ".into(),
                created_at: "2026-11-02T09:00:00Z".into(),
                date_from: "2026-08-05".into(),
                date_to: "2026-11-02".into(),
                days: 90,
                kpis: vec![SnapshotKpi { label: "Klikken".into(), value: "1.234".into() }],
                sections: vec![
                    SnapshotSection {
                        title: "Top pagina's".into(),
                        head: vec!["Pagina".into(), "Klikken".into()],
                        rows: vec![vec!["/zwembaden".into(), "120".into()]],
                        note: None,
                    },
                    SnapshotSection {
                        title: "   ".into(),
                        head: Vec::new(),
                        rows: Vec::new(),
                        note: None,
                    },
                ],
            },
            ReportSnapshot {
                id: "r2".into(),
                title: "Leeg rapport".into(),
                created_at: String::new(),
                date_from: String::new(),
                date_to: String::new(),
                days: 0,
                kpis: Vec::new(),
                sections: Vec::new(),
            },
        ]);
        assert_eq!(opgeschoond.len(), 1, "rapport zonder inhoud hoort te vervallen");
        assert_eq!(opgeschoond[0].title, "SEO-rapport");
        assert_eq!(opgeschoond[0].sections.len(), 1, "sectie zonder titel vervalt");
        assert_eq!(opgeschoond[0].sections[0].rows[0][0], "/zwembaden");
    }
}
