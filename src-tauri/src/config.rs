use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppConfig {
    pub windsor_api_key: Option<String>,
    pub mistral_api_key: Option<String>,
    pub mistral_model: String,
    pub accounts: HashMap<String, String>,
    pub python_path: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            windsor_api_key: None,
            mistral_api_key: None,
            mistral_model: "mistral-small-latest".into(),
            accounts: HashMap::new(),
            python_path: "python3".into(),
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
