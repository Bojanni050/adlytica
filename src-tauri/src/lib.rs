mod adly;
mod analytics;
mod audit;
mod oauth;
mod config;
mod dataforseo;
mod pagespeed;
mod rankings;
mod trends;
mod wordpress;

use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{Manager, State};

/// Voortgang van een loginpoging, zodat de UI de URL én de afloop kan ophalen
/// zonder van events afhankelijk te zijn.
#[derive(Default, Clone, serde::Serialize)]
pub struct LoginState {
    /// "idle" | "pending" | "ok" | "error"
    pub phase: String,
    pub message: String,
    pub url: String,
}

#[derive(Default)]
pub struct AppState {
    pub analytics_base_url: Mutex<Option<String>>,
    pub analytics_creds: Mutex<oauth::Credentials>,
    pub login: Mutex<LoginState>,
    pub mistral_api_key: Mutex<Option<String>>,
    pub mistral_model: Mutex<String>,
    pub accounts: Mutex<HashMap<String, String>>,
    pub dashboard_layout: Mutex<Option<serde_json::Value>>,
    pub wp_url: Mutex<Option<String>>,
    pub wp_user: Mutex<Option<String>>,
    pub wp_app_password: Mutex<Option<String>>,
    pub brand: Mutex<Option<serde_json::Value>>,
    pub pagespeed_api_key: Mutex<Option<String>>,
    pub dataforseo_login: Mutex<Option<String>>,
    pub dataforseo_password: Mutex<Option<String>>,
    pub notifications_enabled: Mutex<bool>,
    pub alerts: Mutex<config::AlertSettings>,
    pub actions: Mutex<Vec<config::ActionItem>>,
    /// Hergebruik van queryresultaten (5 minuten), zie `analytics::QueryCache`.
    pub query_cache: Mutex<analytics::QueryCache>,
    /// Bevroren rapporten; nieuwste eerst.
    pub reports: Mutex<Vec<config::ReportSnapshot>>,
    /// Logboek van wijzigingen in Google Ads (met undo-mogelijkheid).
    pub change_log: Mutex<Vec<config::ChangeLogEntry>>,
    pub trends: trends::TrendsState,
}

fn present(value: String) -> Option<String> {
    if value.trim().is_empty() {
        None
    } else {
        Some(value)
    }
}

fn persist(state: &AppState) {
    // Elke lock in zijn eigen statement: guard leeft nooit verder dan de regel
    // zelf, dus nooit "base_url vasthouden terwijl we nog tien andere locks pakken".
    let creds = state.analytics_creds.lock().unwrap().clone();
    let analytics_base_url = state.analytics_base_url.lock().unwrap().clone();
    let mistral_api_key = state.mistral_api_key.lock().unwrap().clone();
    let mistral_model = state.mistral_model.lock().unwrap().clone();
    let accounts = state.accounts.lock().unwrap().clone();
    let python_path = state.trends.python.lock().unwrap().clone();
    let dashboard_layout = state.dashboard_layout.lock().unwrap().clone();
    let wp_url = state.wp_url.lock().unwrap().clone();
    let wp_user = state.wp_user.lock().unwrap().clone();
    let wp_app_password = state.wp_app_password.lock().unwrap().clone();
    let brand = state.brand.lock().unwrap().clone();
    let pagespeed_api_key = state.pagespeed_api_key.lock().unwrap().clone();
    let dataforseo_login = state.dataforseo_login.lock().unwrap().clone();
    let dataforseo_password = state.dataforseo_password.lock().unwrap().clone();
    let notifications_enabled = *state.notifications_enabled.lock().unwrap();
    let alerts = state.alerts.lock().unwrap().clone();
    let actions = state.actions.lock().unwrap().clone();
    let reports = state.reports.lock().unwrap().clone();
    let change_log = state.change_log.lock().unwrap().clone();
    let cfg = config::AppConfig {
        analytics_base_url,
        analytics_access_token: present(creds.access_token.clone()),
        analytics_refresh_token: creds.refresh_token.clone(),
        analytics_client_id: creds.client_id.clone(),
        mistral_api_key,
        mistral_model,
        accounts,
        python_path,
        dashboard_layout,
        wp_url,
        wp_user,
        wp_app_password,
        brand,
        pagespeed_api_key,
        dataforseo_login,
        dataforseo_password,
        notifications_enabled,
        alerts,
        actions,
        reports,
        change_log,
    };
    if let Err(e) = config::save(&cfg) {
        eprintln!("Config niet opgeslagen: {e}");
    }
}

#[derive(serde::Serialize)]
pub struct SettingsStatus {
    pub analytics_base_url: Option<String>,
    pub analytics_token_set: bool,
    /// True als er een refresh-token is: dan kan de app zelf vernieuwen.
    pub analytics_can_refresh: bool,
    pub mistral_key_set: bool,
    pub mistral_model: String,
    pub accounts: HashMap<String, String>,
    pub python_path: String,
    pub config_path: Option<String>,
    /** Pad van het login-logboek, voor de hint in instellingen. */
    pub login_log_path: Option<String>,
    pub wp_url: Option<String>,
    pub wp_user: Option<String>,
    pub wp_password_set: bool,
    pub pagespeed_key_set: bool,
    pub dataforseo_set: bool,
    /// Instelbare drempels en schakelaars voor de dashboard-alerts.
    pub alerts: config::AlertSettings,
}

fn analytics_client(state: &AppState) -> Result<analytics::AnalyticsClient, String> {
    let creds = state.analytics_creds.lock().unwrap().clone();
    if creds.is_empty() {
        return Err("Nog niet ingelogd op de databron. Ga naar Instellingen en log in.".to_string());
    }
    let base = state.analytics_base_url.lock().unwrap().clone();
    Ok(analytics::AnalyticsClient::new(base, creds))
}

/// Schrijft een door de client vernieuwd token terug naar state en config.
fn persist_refreshed_creds(state: &AppState, client: &analytics::AnalyticsClient) {
    let fresh = client.credentials();
    let changed = {
        let current = state.analytics_creds.lock().unwrap();
        current.access_token != fresh.access_token || current.refresh_token != fresh.refresh_token
    };
    if changed {
        *state.analytics_creds.lock().unwrap() = fresh;
        persist(state);
    }
}

#[tauri::command]
async fn set_analytics_config(
    base_url: String,
    token: String,
    accounts: HashMap<String, String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if !base_url.trim().is_empty() {
        *state.analytics_base_url.lock().unwrap() = Some(base_url.trim().to_string());
    }
    if !token.trim().is_empty() {
        let mut creds = state.analytics_creds.lock().unwrap();
        creds.access_token = token.trim().to_string();
    }
    *state.accounts.lock().unwrap() = accounts;
    persist(&state);
    Ok(())
}

/// Start de login (DCR + PKCE) en geeft de authorize-URL terug. Het wachten op de
/// callback loopt daarna in een achtergrondtaak; de UI haalt de afloop op met
/// `analytics_login_status`. De URL komt zo als gewone returnwaarde binnen — events
/// kunnen niet stilvallen.
#[tauri::command]
async fn analytics_login_start(
    app: tauri::AppHandle,
    base_url: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    oauth::log_step("login-knop: inloggen aangevraagd");
    let base = if base_url.trim().is_empty() {
        state
            .analytics_base_url
            .lock()
            .unwrap()
            .clone()
            .unwrap_or_else(|| analytics::DEFAULT_BASE_URL.to_string())
    } else {
        base_url.trim().to_string()
    };
    *state.analytics_base_url.lock().unwrap() = Some(base.clone());
    persist(&state);
    oauth::log_step("service-URL bewaard in config");
    {
        let mut login = state.login.lock().unwrap();
        login.phase = "pending".into();
        login.message = "Bezig met inloggen — rond de login in je browser af.".into();
        login.url.clear();
    }
    let (url, pending) = oauth::prepare(&base).await.map_err(|e| {
        let mut login = state.login.lock().unwrap();
        login.phase = "error".into();
        login.message = format!("✗ {e}");
        e
    })?;

    {
        let mut login = state.login.lock().unwrap();
        login.url = url.clone();
        login.message = "Browser geopend. Opent hij niet? Open de URL hieronder zelf.".into();
    }

    match oauth::open_browser(&url) {
        Ok(()) => oauth::log_step("browser-opdracht gegeven (rundll32)"),
        Err(e) => {
            oauth::log_step(&format!("browser-open mislukt: {e}"));
            let mut login = state.login.lock().unwrap();
            login.message = format!("Kon de browser niet openen ({e}) — open de URL hieronder zelf.");
        }
    }

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let outcome = oauth::finish(pending, std::time::Duration::from_secs(300)).await;
        let shared = app_handle.state::<AppState>();
        let mut login = shared.login.lock().unwrap();
        match outcome {
            Ok(creds) => {
                let can_refresh = creds.refresh_token.is_some();
                *shared.analytics_creds.lock().unwrap() = creds;
                drop(login);
                persist(&shared);
                let mut login = shared.login.lock().unwrap();
                login.phase = "ok".into();
                login.message = if can_refresh {
                    "✓ Ingelogd — de app kan het token nu zelf vernieuwen.".to_string()
                } else {
                    "✓ Ingelogd (zonder refresh-token, dus later opnieuw inloggen).".to_string()
                };
                login.url.clear();
            }
            Err(e) => {
                login.phase = "error".into();
                login.message = format!("✗ {e}");
            }
        }
    });

    Ok(url)
}

/// Voortgang van de laatste loginpoging.
#[tauri::command]
fn analytics_login_status(state: State<'_, AppState>) -> LoginState {
    state.login.lock().unwrap().clone()
}

/// Wist de inloggegevens van de databron.
#[tauri::command]
async fn analytics_logout(state: State<'_, AppState>) -> Result<(), String> {
    *state.analytics_creds.lock().unwrap() = oauth::Credentials::default();
    let mut login = state.login.lock().unwrap();
    login.phase = "idle".into();
    login.message.clear();
    login.url.clear();
    drop(login);
    persist(&state);
    Ok(())
}

/// Test de databron: GET /health van de analytics-service.
#[tauri::command]
async fn test_analytics(state: State<'_, AppState>) -> Result<String, String> {
    let client = analytics_client(&state)?;
    let version = client.health().await.map_err(|e| e.to_string())?;
    Ok(format!("✓ Databron bereikbaar (versie {version})"))
}

#[tauri::command]
async fn set_mistral_config(
    api_key: String,
    model: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if !api_key.trim().is_empty() {
        *state.mistral_api_key.lock().unwrap() = Some(api_key);
    }
    *state.mistral_model.lock().unwrap() = model;
    persist(&state);
    Ok(())
}

#[tauri::command]
async fn get_accounts(state: State<'_, AppState>) -> Result<HashMap<String, String>, String> {
    Ok(state.accounts.lock().unwrap().clone())
}

#[tauri::command]
async fn get_settings_status(state: State<'_, AppState>) -> Result<SettingsStatus, String> {
    // Locks allemaal in eigen statements (geen lang-levende guard binnen de
    // struct-literal) — zelfde reden als bij persist.
    let base_url = state
        .analytics_base_url
        .lock()
        .unwrap()
        .clone()
        .or_else(|| Some(analytics::DEFAULT_BASE_URL.to_string()));
    let creds = state.analytics_creds.lock().unwrap().clone();
    let mistral_key_set = state.mistral_api_key.lock().unwrap().is_some();
    let mistral_model = state.mistral_model.lock().unwrap().clone();
    let accounts = state.accounts.lock().unwrap().clone();
    let python_path = state.trends.python.lock().unwrap().clone();
    let wp_url = state.wp_url.lock().unwrap().clone();
    let wp_user = state.wp_user.lock().unwrap().clone();
    let wp_password_set = state.wp_app_password.lock().unwrap().is_some();
    let pagespeed_key_set = state.pagespeed_api_key.lock().unwrap().is_some();
    let dataforseo_set = state.dataforseo_login.lock().unwrap().is_some()
        && state.dataforseo_password.lock().unwrap().is_some();
    let alerts = state.alerts.lock().unwrap().clone();
    Ok(SettingsStatus {
        analytics_base_url: base_url,
        analytics_token_set: !creds.is_empty(),
        analytics_can_refresh: creds.refresh_token.is_some(),
        mistral_key_set,
        mistral_model,
        accounts,
        python_path,
        config_path: config::config_path().map(|p| p.to_string_lossy().into_owned()),
        login_log_path: oauth::log_path().map(|p| p.to_string_lossy().into_owned()),
        wp_url,
        wp_user,
        wp_password_set,
        pagespeed_key_set,
        dataforseo_set,
        alerts,
    })
}

/// Bewaart de alert-drempels uit Instellingen en geeft de opgeschoonde versie
/// terug, zodat de UI meteen laat zien wat er echt is opgeslagen.
#[tauri::command]
async fn set_alert_settings(
    settings: config::AlertSettings,
    state: State<'_, AppState>,
) -> Result<config::AlertSettings, String> {
    let clean = settings.sanitized();
    *state.alerts.lock().unwrap() = clean.clone();
    persist(&state);
    Ok(clean)
}

/// De takenlijst van het actiecentrum, in opslagvolgorde.
#[tauri::command]
fn get_actions(state: State<'_, AppState>) -> Vec<config::ActionItem> {
    state.actions.lock().unwrap().clone()
}

/// Vervangt de takenlijst. De backend schoont op (lengtes, statussen, maximum
/// aantal taken) en geeft terug wat er echt is opgeslagen.
#[tauri::command]
fn set_actions(
    actions: Vec<config::ActionItem>,
    state: State<'_, AppState>,
) -> Result<Vec<config::ActionItem>, String> {
    let clean = config::sanitized_actions(actions);
    *state.actions.lock().unwrap() = clean.clone();
    persist(&state);
    Ok(clean)
}

#[tauri::command]
fn get_report_snapshots(state: State<'_, AppState>) -> Vec<config::ReportSnapshot> {
    state.reports.lock().unwrap().clone()
}

/// Bewaart een rapport zoals het nu is. Bestaat het id al, dan wordt die
/// vervangen; het nieuwste rapport staat altijd bovenaan.
#[tauri::command]
fn save_report_snapshot(
    report: config::ReportSnapshot,
    state: State<'_, AppState>,
) -> Result<Vec<config::ReportSnapshot>, String> {
    let clean = {
        let mut list = state.reports.lock().unwrap();
        list.retain(|existing| existing.id != report.id);
        list.insert(0, report);
        let clean = config::sanitized_reports(list.clone());
        *list = clean.clone();
        clean
    };
    persist(&state);
    Ok(clean)
}

#[tauri::command]
fn delete_report_snapshot(
    id: String,
    state: State<'_, AppState>,
) -> Result<Vec<config::ReportSnapshot>, String> {
    let clean = {
        let mut list = state.reports.lock().unwrap();
        list.retain(|existing| existing.id != id);
        list.clone()
    };
    persist(&state);
    Ok(clean)
}

/// Wijzigingen die de app zelf in Google Ads mag doorvoeren. Bewust kort:
/// alles wat niet veilig te previewen of terug te draaien is, staat er niet in.
const ADS_ALLOWED_ACTIONS: [&str; 3] = ["pause_campaign", "enable_campaign", "push_negative_keywords"];
/// Bovengrens per dag, geteld uit het logboek. Een verkeerd gelopen script of
/// een dubbelklik mag nooit tientallen campagnes omzetten.
const ADS_DAILY_LIMIT: usize = 20;
const MAX_NEGATIVE_KEYWORDS: usize = 50;

#[derive(serde::Serialize)]
pub struct AdsActionResult {
    entry: config::ChangeLogEntry,
    log: Vec<config::ChangeLogEntry>,
}

/// Elke wijziging is terug te draaien door precies de omgekeerde actie.
fn undo_action(action: &str) -> Option<&'static str> {
    match action {
        "pause_campaign" => Some("enable_campaign"),
        "enable_campaign" => Some("pause_campaign"),
        _ => None,
    }
}

fn campaign_id_of(params: &serde_json::Value) -> &str {
    params
        .get("campaign_id")
        .or_else(|| params.get("campaignId"))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .unwrap_or("")
}

fn validate_ads_params(action: &str, params: &serde_json::Value) -> Result<(), String> {
    if campaign_id_of(params).is_empty() {
        return Err("Deze wijziging hoort bij een campagne; campagne-id ontbreekt.".into());
    }
    if action == "push_negative_keywords" {
        let keywords = params
            .get("keywords")
            .and_then(|value| value.as_array())
            .ok_or_else(|| "Geen zoektermen opgegeven.".to_string())?;
        let clean: Vec<&str> = keywords
            .iter()
            .filter_map(|keyword| keyword.as_str())
            .map(str::trim)
            .filter(|keyword| !keyword.is_empty())
            .collect();
        if clean.is_empty() {
            return Err("Geen zoektermen opgegeven.".into());
        }
        if clean.len() > MAX_NEGATIVE_KEYWORDS {
            return Err(format!("Maximaal {MAX_NEGATIVE_KEYWORDS} zoektermen per keer."));
        }
        if clean.iter().any(|keyword| keyword.chars().count() > 80) {
            return Err("Een zoekterm is te lang (maximaal 80 tekens).".into());
        }
    }
    Ok(())
}

fn make_change_id() -> String {
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    format!("ads-{millis}")
}

#[tauri::command]
fn get_change_log(state: State<'_, AppState>) -> Vec<config::ChangeLogEntry> {
    state.change_log.lock().unwrap().clone()
}

/// Voert één wijziging uit, maar alleen binnen de whitelist, met een
/// daglimiet en met een logboekregel — ook als de aanroep mislukt.
#[tauri::command]
async fn ads_apply_change(
    action: String,
    params: serde_json::Value,
    title: String,
    undo_of: Option<String>,
    state: State<'_, AppState>,
) -> Result<AdsActionResult, String> {
    if !ADS_ALLOWED_ACTIONS.contains(&action.as_str()) {
        return Err(format!("Deze wijziging ({action}) is niet toegestaan vanuit de app."));
    }
    validate_ads_params(&action, &params)?;

    if let Some(original_id) = undo_of.as_deref() {
        let original_action = {
            let log = state.change_log.lock().unwrap();
            log.iter()
                .find(|entry| entry.id == original_id)
                .map(|entry| entry.action.clone())
        };
        let Some(original_action) = original_action else {
            return Err("Die wijziging staat niet (meer) in het logboek.".into());
        };
        if undo_action(&original_action) != Some(action.as_str()) {
            return Err("Deze actie hoort niet bij het ongedaan maken van die wijziging.".into());
        }
    }

    let account = {
        let accounts = state.accounts.lock().unwrap();
        accounts.get("google_ads").cloned().unwrap_or_default()
    };
    if account.trim().is_empty() {
        return Err("Stel eerst een Google Ads-account in bij Instellingen.".into());
    }

    let today = analytics::today_utc();
    let used = {
        let log = state.change_log.lock().unwrap();
        log.iter()
            .filter(|entry| entry.at.starts_with(&today) && entry.status != "mislukt")
            .count()
    };
    if used >= ADS_DAILY_LIMIT {
        return Err(format!(
            "Daglimiet van {ADS_DAILY_LIMIT} wijzigingen bereikt. Probeer het morgen weer."
        ));
    }

    let client = analytics_client(&state)?;
    let outcome = client
        .execute_action("google_ads", &account, &action, &params)
        .await;
    persist_refreshed_creds(&state, &client);

    let at = analytics::utc_now_iso();
    let entry = config::ChangeLogEntry {
        id: make_change_id(),
        at,
        connector: "google_ads".into(),
        account,
        action: action.clone(),
        title: if title.trim().is_empty() { action.clone() } else { title.trim().to_string() },
        params,
        status: if outcome.is_ok() { "uitgevoerd".into() } else { "mislukt".into() },
        message: outcome.as_ref().err().map(|error| error.to_string()),
        undone_by: None,
        undo_of,
    };

    let log = {
        let mut log = state.change_log.lock().unwrap();
        if outcome.is_ok() {
            if let Some(original_id) = entry.undo_of.as_deref() {
                for existing in log.iter_mut() {
                    if existing.id == original_id {
                        existing.undone_by = Some(entry.id.clone());
                        existing.status = "teruggedraaid".into();
                    }
                }
            }
        }
        log.insert(0, entry.clone());
        let clean = config::sanitized_changes(log.clone());
        *log = clean.clone();
        clean
    };
    persist(&state);
    Ok(AdsActionResult { entry, log })
}

#[tauri::command]
async fn get_dashboard_layout(
    state: State<'_, AppState>,
) -> Result<Option<serde_json::Value>, String> {
    Ok(state.dashboard_layout.lock().unwrap().clone())
}

#[tauri::command]
async fn set_dashboard_layout(
    layout: Option<serde_json::Value>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    *state.dashboard_layout.lock().unwrap() = layout;
    persist(&state);
    Ok(())
}

#[tauri::command]
async fn set_wordpress_config(
    url: String,
    user: String,
    password: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let url = url.trim().trim_end_matches('/').to_string();
    let user = user.trim().to_string();
    *state.wp_url.lock().unwrap() = if url.is_empty() { None } else { Some(url) };
    *state.wp_user.lock().unwrap() = if user.is_empty() { None } else { Some(user) };
    // Net als bij de Mistral-key: leeg laten betekent "bestaand wachtwoord behouden".
    if !password.trim().is_empty() {
        *state.wp_app_password.lock().unwrap() = Some(password.trim().to_string());
    }
    persist(&state);
    Ok(())
}

fn wordpress_client(state: &AppState) -> Result<wordpress::WordpressClient, String> {
    let url = state.wp_url.lock().unwrap().clone().unwrap_or_default();
    let user = state.wp_user.lock().unwrap().clone().unwrap_or_default();
    let password = state.wp_app_password.lock().unwrap().clone().unwrap_or_default();
    if url.trim().is_empty() || user.trim().is_empty() || password.trim().is_empty() {
        return Err(
            "WordPress is nog niet ingesteld. Vul de site-URL, gebruikersnaam en een \
             applicatiewachtwoord in bij Instellingen."
                .into(),
        );
    }
    Ok(wordpress::WordpressClient::new(url, user, password))
}

#[tauri::command]
async fn test_wordpress(state: State<'_, AppState>) -> Result<String, String> {
    let client = wordpress_client(&state)?;
    client.ping().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_wp_seo(
    url: String,
    state: State<'_, AppState>,
) -> Result<wordpress::WpSeo, String> {
    let client = wordpress_client(&state)?;
    let target = client.find_page(&url).await.map_err(|e| e.to_string())?;
    client
        .get_seo(&target.post_type, target.id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn set_wp_seo(
    kind: String,
    id: u64,
    title: String,
    description: String,
    state: State<'_, AppState>,
) -> Result<wordpress::WpSeo, String> {
    let client = wordpress_client(&state)?;
    client
        .set_seo(&kind, id, &title, &description)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_rankings() -> rankings::RankingStore {
    rankings::load()
}

#[tauri::command]
async fn track_keyword(keyword: String) -> Result<rankings::RankingStore, String> {
    let mut store = rankings::load();
    store.track(&keyword)?;
    rankings::save(&store)?;
    Ok(store)
}

#[tauri::command]
async fn untrack_keyword(keyword: String) -> Result<rankings::RankingStore, String> {
    let mut store = rankings::load();
    store.untrack(&keyword);
    rankings::save(&store)?;
    Ok(store)
}

#[tauri::command]
async fn record_rank_points(points: Vec<rankings::RankPayload>) -> Result<rankings::RankingStore, String> {
    let mut store = rankings::load();
    store.record(points);
    rankings::save(&store)?;
    Ok(store)
}

#[tauri::command]
async fn analytics_query(
    params: analytics::QueryParams,
    refresh: Option<bool>,
    state: State<'_, AppState>,
) -> Result<analytics::QueryResult, String> {
    let key = analytics::cache_key(&params);
    if !refresh.unwrap_or(false) {
        // Guard in een eigen statement: nooit een lock vasthouden over een await.
        let cached = state.query_cache.lock().unwrap().get(&key);
        if let Some(rows) = cached {
            return Ok(analytics::QueryResult { rows });
        }
    }
    let client = analytics_client(&state)?;
    let result = client.get_data(&params).await;
    persist_refreshed_creds(&state, &client);
    let result = result.map_err(|e| e.to_string())?;
    state.query_cache.lock().unwrap().put(key, result.rows.clone());
    Ok(result)
}

#[tauri::command]
fn analytics_cache_clear(state: State<'_, AppState>) -> usize {
    state.query_cache.lock().unwrap().clear()
}

#[tauri::command]
fn analytics_cache_stats(state: State<'_, AppState>) -> analytics::CacheStats {
    state.query_cache.lock().unwrap().stats()
}

#[tauri::command]
async fn analytics_action(
    connector: String,
    account: String,
    action: String,
    params: serde_json::Value,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let client = analytics_client(&state)?;
    let result = client
        .execute_action(&connector, &account, &action, &params)
        .await;
    persist_refreshed_creds(&state, &client);
    result.map_err(|e| e.to_string())
}

#[tauri::command]
async fn adly_chat(
    messages: Vec<adly::ChatMessage>,
    context: Option<String>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let key = state
        .mistral_api_key
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "Geen Mistral API-key ingesteld. Ga naar Instellingen.".to_string())?;
    let model = state.mistral_model.lock().unwrap().clone();
    let client = adly::AdlyClient::new(key);
    let system = adly::system_prompt(&context);
    client
        .chat(&model, &system, &messages)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn trends_query(
    req: trends::TrendsRequest,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let mut guard = state.trends.sidecar.lock().unwrap();
    if guard.is_none() {
        let python = state.trends.python.lock().unwrap().clone();
        let script = std::env::current_dir()
            .map_err(|e| e.to_string())?
            .join("trends_sidecar.py");
        let sidecar = trends::TrendsSidecar::start(&python, script.to_string_lossy().as_ref())
            .map_err(|e| e.to_string())?;
        *guard = Some(sidecar);
    }
    let sidecar = guard.as_mut().unwrap();
    sidecar.call(&req).map_err(|e| e.to_string())
}

#[tauri::command]
async fn set_python_path(python: String, state: State<'_, AppState>) -> Result<(), String> {
    *state.trends.python.lock().unwrap() = python;
    persist(&state);
    Ok(())
}

#[tauri::command]
async fn get_brand(state: State<'_, AppState>) -> Result<Option<serde_json::Value>, String> {
    Ok(state.brand.lock().unwrap().clone())
}

#[tauri::command]
async fn set_brand(
    brand: Option<serde_json::Value>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    *state.brand.lock().unwrap() = brand;
    persist(&state);
    Ok(())
}

#[tauri::command]
async fn get_notifications(state: State<'_, AppState>) -> Result<bool, String> {
    Ok(*state.notifications_enabled.lock().unwrap())
}

#[tauri::command]
async fn set_notifications(enabled: bool, state: State<'_, AppState>) -> Result<(), String> {
    *state.notifications_enabled.lock().unwrap() = enabled;
    persist(&state);
    Ok(())
}

/// Toont een Windows-melding, maar alleen als de gebruiker ze heeft aangezet.
#[tauri::command]
async fn notify_now(
    title: String,
    body: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if !*state.notifications_enabled.lock().unwrap() {
        return Ok(());
    }
    show_notification(&app, &title, &body)
}

/// Testmelding vanuit Instellingen; negeert de schakelaar zodat je hem kunt proberen.
#[tauri::command]
async fn test_notification(app: tauri::AppHandle) -> Result<(), String> {
    show_notification(
        &app,
        "Adlytica",
        "Meldingen werken. Je krijgt bericht zodra er iets opvalt in je data.",
    )
}

/// Schrijft een PDF die de frontend heeft opgebouwd naar de map Downloads.
#[tauri::command]
async fn save_pdf(filename: String, bytes: Vec<u8>) -> Result<String, String> {
    let safe: String = filename
        .chars()
        .map(|c| if c.is_alphanumeric() || matches!(c, '-' | '_' | '.') { c } else { '-' })
        .collect();
    let name = if safe.to_lowercase().ends_with(".pdf") { safe } else { format!("{safe}.pdf") };
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .ok_or_else(|| "Kon de thuismap niet bepalen".to_string())?;
    let base = std::path::PathBuf::from(home);
    let downloads = base.join("Downloads");
    let dir = if downloads.is_dir() { downloads } else { base };
    let path = dir.join(name);
    std::fs::write(&path, bytes).map_err(|e| format!("Kon het PDF-bestand niet opslaan: {e}"))?;
    Ok(path.to_string_lossy().to_string())
}

/// Opent een bestand met de standaardapp (rimpel: rundll32 belt ShellExecute —
/// geen cmd, want die verprutst paden en URL's, zie open_browser in oauth.rs).
#[tauri::command]
async fn open_path(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        return std::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", path.as_str()])
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Kon het bestand niet openen: {e}"));
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = path;
        Err("Alleen op Windows een standaardapp; hier is geen opener geïnstalleerd.".into())
    }
}

/// Toont een bestand in de Verkenner (map openen met het bestand geselecteerd).
/// `explorer /select` parseert zijn opdrachtregel zelf, dus het pad moet letterlijk
/// (raw_arg) met komma en de eigen aanhalingstekens worden doorgegeven.
#[tauri::command]
async fn reveal_path(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        return std::process::Command::new("explorer")
            .raw_arg(format!("/select,\"{path}\""))
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Kon de map niet openen: {e}"));
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = path;
        Err("Alleen op Windows met de Verkenner; hier is geen verkenner geïnstalleerd.".into())
    }
}

fn show_notification(app: &tauri::AppHandle, title: &str, body: &str) -> Result<(), String> {    use tauri_plugin_notification::NotificationExt;
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| format!("Melding kon niet worden getoond: {e}"))
}

/// Crawlt de site en controleert elke pagina op technische SEO-problemen.
#[tauri::command]
async fn run_audit(url: String, limit: Option<u32>) -> Result<audit::AuditResult, String> {
    let limit = limit.unwrap_or(100).clamp(1, 500) as usize;
    let mut result = audit::audit_site(&url, limit).await?;
    result.previous = audit::record(&result);
    Ok(result)
}

#[tauri::command]
async fn set_pagespeed_key(key: String, state: State<'_, AppState>) -> Result<(), String> {
    let trimmed = key.trim().to_string();
    *state.pagespeed_api_key.lock().unwrap() = if trimmed.is_empty() { None } else { Some(trimmed) };
    persist(&state);
    Ok(())
}

/// Meet een pagina met PageSpeed Insights (Lighthouse, mobiel of desktop).
#[tauri::command]
async fn pagespeed(
    url: String,
    strategy: Option<String>,
    state: State<'_, AppState>,
) -> Result<pagespeed::PageSpeedResult, String> {
    let key = state
        .pagespeed_api_key
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "Vul eerst een PageSpeed API-key in bij Instellingen.".to_string())?;
    pagespeed::measure(&url, &key, strategy.as_deref().unwrap_or("mobile")).await
}

#[tauri::command]
async fn set_dataforseo(
    login: String,
    password: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let user = login.trim();
    let secret = password.trim();
    *state.dataforseo_login.lock().unwrap() = if user.is_empty() { None } else { Some(user.to_string()) };
    *state.dataforseo_password.lock().unwrap() = if secret.is_empty() { None } else { Some(secret.to_string()) };
    persist(&state);
    Ok(())
}

/// Vergelijkt het eigen domein met concurrenten via de betaalde DataForSEO Labs API.
#[tauri::command]
async fn dataforseo_gap(
    domains: Vec<String>,
    limit: Option<u32>,
    state: State<'_, AppState>,
) -> Result<dataforseo::GapResult, String> {
    let login = state
        .dataforseo_login
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "Vul eerst je DataForSEO-login en wachtwoord in bij Instellingen.".to_string())?;
    let password = state
        .dataforseo_password
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "Vul eerst je DataForSEO-login en wachtwoord in bij Instellingen.".to_string())?;
    dataforseo::gap(&login, &password, &domains, limit.unwrap_or(500).clamp(50, 1000)).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .manage({
            let cfg = config::load();
            AppState {
                analytics_base_url: Mutex::new(cfg.analytics_base_url),
                login: Mutex::new(LoginState::default()),
                analytics_creds: Mutex::new(oauth::Credentials {
                    access_token: cfg.analytics_access_token.unwrap_or_default(),
                    refresh_token: cfg.analytics_refresh_token,
                    client_id: cfg.analytics_client_id,
                }),
                mistral_api_key: Mutex::new(cfg.mistral_api_key),
                mistral_model: Mutex::new(cfg.mistral_model),
                accounts: Mutex::new(cfg.accounts),
                dashboard_layout: Mutex::new(cfg.dashboard_layout),
                wp_url: Mutex::new(cfg.wp_url),
                wp_user: Mutex::new(cfg.wp_user),
                wp_app_password: Mutex::new(cfg.wp_app_password),
                brand: Mutex::new(cfg.brand),
                pagespeed_api_key: Mutex::new(cfg.pagespeed_api_key),
                dataforseo_login: Mutex::new(cfg.dataforseo_login),
                dataforseo_password: Mutex::new(cfg.dataforseo_password),
                notifications_enabled: Mutex::new(cfg.notifications_enabled),
                alerts: Mutex::new(cfg.alerts.clone().sanitized()),
                actions: Mutex::new(config::sanitized_actions(cfg.actions.clone())),
                reports: Mutex::new(config::sanitized_reports(cfg.reports.clone())),
                change_log: Mutex::new(config::sanitized_changes(cfg.change_log.clone())),
                query_cache: Mutex::new(analytics::QueryCache::default()),
                trends: trends::TrendsState {
                    sidecar: Mutex::new(None),
                    python: Mutex::new(cfg.python_path),
                },
            }
        })
        .invoke_handler(tauri::generate_handler![
            set_analytics_config,
            test_analytics,
            analytics_login_start,
            analytics_login_status,
            analytics_logout,
            set_mistral_config,
            get_settings_status,
            get_accounts,
            analytics_query,
            analytics_cache_clear,
            analytics_cache_stats,
            analytics_action,
            adly_chat,
            trends_query,
            set_python_path,
            get_dashboard_layout,
            set_dashboard_layout,
            get_rankings,
            track_keyword,
            untrack_keyword,
            record_rank_points,
            set_wordpress_config,
            test_wordpress,
            get_wp_seo,
            set_wp_seo,
            get_brand,
            set_brand,
            get_notifications,
            set_notifications,
            set_alert_settings,
            get_actions,
            set_actions,
            get_report_snapshots,
            save_report_snapshot,
            delete_report_snapshot,
            get_change_log,
            ads_apply_change,
            notify_now,
            test_notification,
            set_dataforseo,
            dataforseo_gap,
            run_audit,
            pagespeed,
            set_pagespeed_key,
            save_pdf,
            open_path,
            reveal_path
        ])
        .run(tauri::generate_context!())
        .expect("Adlytica kon niet starten");
}
