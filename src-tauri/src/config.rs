use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppConfig {
    // Elk veld is `default`, zodat een bestaand config.json zonder nieuw veld
    // niet de hele configuratie (inclusief API-keys) op default zet.
    #[serde(default)]
    pub windsor_api_key: Option<String>,
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
            windsor_api_key: None,
            mistral_api_key: None,
            mistral_model: default_mistral_model(),
            accounts: HashMap::new(),
            python_path: default_python_path(),
            dashboard_layout: None,
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
    fn config_zonder_layout_blijft_geldig() {
        // Bestaand config.json van vóór het dashboardlayout-veld mag niet op default vallen,
        // anders raken API-keys en accounts kwijt.
        let text = r#"{"windsor_api_key":"w","mistral_api_key":"m","mistral_model":"mistral-small-latest","accounts":{"searchconsole":"acc"},"python_path":"python3"}"#;
        let cfg: AppConfig = serde_json::from_str(text).expect("bestaande config moet leesbaar blijven");
        assert_eq!(cfg.windsor_api_key.as_deref(), Some("w"));
        assert_eq!(cfg.accounts.get("searchconsole").map(String::as_str), Some("acc"));
        assert!(cfg.dashboard_layout.is_none());
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
}
