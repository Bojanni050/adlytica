mod adly;
mod trends;
mod windsor;

use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{Manager, State};

#[derive(Default)]
pub struct AppState {
    pub windsor_api_key: Mutex<Option<String>>,
    pub mistral_api_key: Mutex<Option<String>>,
    pub mistral_model: Mutex<String>,
    pub accounts: Mutex<HashMap<String, String>>,
    pub trends: trends::TrendsState,
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
    Ok(())
}

#[tauri::command]
async fn get_accounts(state: State<'_, AppState>) -> Result<HashMap<String, String>, String> {
    Ok(state.accounts.lock().unwrap().clone())
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
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            windsor_api_key: Mutex::new(None),
            mistral_api_key: Mutex::new(None),
            mistral_model: Mutex::new("mistral-small-latest".into()),
            accounts: Mutex::new(HashMap::new()),
            trends: trends::TrendsState {
                sidecar: Mutex::new(None),
                python: Mutex::new("python3".into()),
            },
        })
        .invoke_handler(tauri::generate_handler![
            set_windsor_key,
            set_mistral_config,
            get_accounts,
            windsor_query,
            windsor_action,
            adly_chat,
            trends_query,
            set_python_path
        ])
        .run(tauri::generate_context!())
        .expect("Adlytica kon niet starten");
}
