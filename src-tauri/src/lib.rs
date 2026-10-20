mod adly;
mod config;
mod rankings;
mod trends;
mod windsor;
mod wordpress;

use std::collections::HashMap;
use std::sync::Mutex;
use tauri::State;

#[derive(Default)]
pub struct AppState {
    pub windsor_api_key: Mutex<Option<String>>,
    pub mistral_api_key: Mutex<Option<String>>,
    pub mistral_model: Mutex<String>,
    pub accounts: Mutex<HashMap<String, String>>,
    pub dashboard_layout: Mutex<Option<serde_json::Value>>,
    pub wp_url: Mutex<Option<String>>,
    pub wp_user: Mutex<Option<String>>,
    pub wp_app_password: Mutex<Option<String>>,
    pub brand: Mutex<Option<serde_json::Value>>,
    pub notifications_enabled: Mutex<bool>,
    pub trends: trends::TrendsState,
}

fn persist(state: &AppState) {
    let cfg = config::AppConfig {
        windsor_api_key: state.windsor_api_key.lock().unwrap().clone(),
        mistral_api_key: state.mistral_api_key.lock().unwrap().clone(),
        mistral_model: state.mistral_model.lock().unwrap().clone(),
        accounts: state.accounts.lock().unwrap().clone(),
        python_path: state.trends.python.lock().unwrap().clone(),
        dashboard_layout: state.dashboard_layout.lock().unwrap().clone(),
        wp_url: state.wp_url.lock().unwrap().clone(),
        wp_user: state.wp_user.lock().unwrap().clone(),
        wp_app_password: state.wp_app_password.lock().unwrap().clone(),
        brand: state.brand.lock().unwrap().clone(),
        notifications_enabled: *state.notifications_enabled.lock().unwrap(),
    };
    if let Err(e) = config::save(&cfg) {
        eprintln!("Config niet opgeslagen: {e}");
    }
}

#[derive(serde::Serialize)]
pub struct SettingsStatus {
    pub windsor_key_set: bool,
    pub mistral_key_set: bool,
    pub mistral_model: String,
    pub accounts: HashMap<String, String>,
    pub python_path: String,
    pub config_path: Option<String>,
    pub wp_url: Option<String>,
    pub wp_user: Option<String>,
    pub wp_password_set: bool,
}

fn windsor_client(state: &AppState) -> Result<windsor::WindsorClient, String> {
    let key = state
        .windsor_api_key
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "Geen Windsor.ai API-key ingesteld. Ga naar Instellingen.".to_string())?;
    Ok(windsor::WindsorClient::new(key))
}

#[tauri::command]
async fn set_windsor_key(
    key: String,
    accounts: HashMap<String, String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    *state.windsor_api_key.lock().unwrap() = Some(key);
    *state.accounts.lock().unwrap() = accounts;
    persist(&state);
    Ok(())
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
    Ok(SettingsStatus {
        windsor_key_set: state.windsor_api_key.lock().unwrap().is_some(),
        mistral_key_set: state.mistral_api_key.lock().unwrap().is_some(),
        mistral_model: state.mistral_model.lock().unwrap().clone(),
        accounts: state.accounts.lock().unwrap().clone(),
        python_path: state.trends.python.lock().unwrap().clone(),
        config_path: config::config_path().map(|p| p.to_string_lossy().into_owned()),
        wp_url: state.wp_url.lock().unwrap().clone(),
        wp_user: state.wp_user.lock().unwrap().clone(),
        wp_password_set: state.wp_app_password.lock().unwrap().is_some(),
    })
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
async fn windsor_query(
    params: windsor::QueryParams,
    state: State<'_, AppState>,
) -> Result<windsor::QueryResult, String> {
    let client = windsor_client(&state)?;
    client
        .get_data(&params)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn windsor_action(
    connector: String,
    account: String,
    action: String,
    params: serde_json::Value,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let client = windsor_client(&state)?;
    client
        .execute_action(&connector, &account, &action, &params)
        .await
        .map_err(|e| e.to_string())
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

fn show_notification(app: &tauri::AppHandle, title: &str, body: &str) -> Result<(), String> {    use tauri_plugin_notification::NotificationExt;
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| format!("Melding kon niet worden getoond: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .manage({
            let cfg = config::load();
            AppState {
                windsor_api_key: Mutex::new(cfg.windsor_api_key),
                mistral_api_key: Mutex::new(cfg.mistral_api_key),
                mistral_model: Mutex::new(cfg.mistral_model),
                accounts: Mutex::new(cfg.accounts),
                dashboard_layout: Mutex::new(cfg.dashboard_layout),
                wp_url: Mutex::new(cfg.wp_url),
                wp_user: Mutex::new(cfg.wp_user),
                wp_app_password: Mutex::new(cfg.wp_app_password),
                brand: Mutex::new(cfg.brand),
                notifications_enabled: Mutex::new(cfg.notifications_enabled),
                trends: trends::TrendsState {
                    sidecar: Mutex::new(None),
                    python: Mutex::new(cfg.python_path),
                },
            }
        })
        .invoke_handler(tauri::generate_handler![
            set_windsor_key,
            set_mistral_config,
            get_settings_status,
            get_accounts,
            windsor_query,
            windsor_action,
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
            notify_now,
            test_notification,
            save_pdf
        ])
        .run(tauri::generate_context!())
        .expect("Adlytica kon niet starten");
}
