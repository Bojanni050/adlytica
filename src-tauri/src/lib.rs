mod adly;
mod config;
mod rankings;
mod trends;
mod windsor;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage({
            let cfg = config::load();
            AppState {
                windsor_api_key: Mutex::new(cfg.windsor_api_key),
                mistral_api_key: Mutex::new(cfg.mistral_api_key),
                mistral_model: Mutex::new(cfg.mistral_model),
                accounts: Mutex::new(cfg.accounts),
                dashboard_layout: Mutex::new(cfg.dashboard_layout),
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
            record_rank_points
        ])
        .run(tauri::generate_context!())
        .expect("Adlytica kon niet starten");
}
