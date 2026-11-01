//! Client voor de self-hosted analytics-service (`analytics-mcp`).
//!
//! De service levert GA4, Search Console en Google Ads onder één bearertoken,
//! met dezelfde request/response-vorm als de vorige externe aggregator:
//! `POST /query` → `{status, data, total_rows}` en
//! `POST /action` → `{status, action, affected}`.
//!
//! Het bearer-token komt uit de Google-login van de service (Instellingen →
//! Databron); dit is geen API-key van een derde partij meer.

use crate::oauth::{self, Credentials};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};

/// Standaardadres van de analytics-service.
pub const DEFAULT_BASE_URL: &str = "https://analytics.studiovanderheide.nl";

#[derive(Debug, Serialize, Deserialize)]
pub struct QueryParams {
    pub connector: String,
    pub account: String,
    pub fields: Vec<String>,
    pub date_from: Option<String>,
    pub date_to: Option<String>,
    #[serde(default)]
    pub group_by: Vec<String>,
    /// Connector-specifieke extra's, bv. `keyword_seeds` voor de Keyword Planner.
    pub options: Option<serde_json::Value>,
    pub limit: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct QueryResult {
    pub rows: Vec<serde_json::Value>,
}

#[derive(Debug)]
pub struct AnalyticsError(pub String);

impl std::fmt::Display for AnalyticsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl From<reqwest::Error> for AnalyticsError {
    fn from(e: reqwest::Error) -> Self {
        AnalyticsError(format!("Netwerkfout: {e}"))
    }
}

impl From<serde_json::Error> for AnalyticsError {
    fn from(e: serde_json::Error) -> Self {
        AnalyticsError(format!("Ongeldige API-reactie: {e}"))
    }
}

/// Kort een (mogelijk lange) foutbody in voor weergave in de app.
fn shorten(text: &str) -> String {
    if text.chars().count() > 400 {
        let short: String = text.chars().take(400).collect();
        format!("{short}…")
    } else {
        text.to_string()
    }
}

/// Haalt het `error`-veld uit een JSON-foutbody, of geeft de ruwe tekst terug.
fn error_message(text: &str) -> String {
    match serde_json::from_str::<serde_json::Value>(text) {
        Ok(value) => value
            .get("error")
            .and_then(|e| e.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| shorten(text)),
        Err(_) => shorten(text),
    }
}

pub struct AnalyticsClient {
    http: reqwest::Client,
    base_url: String,
    creds: Arc<Mutex<Credentials>>,
}

impl AnalyticsClient {
    pub fn new(base_url: Option<String>, creds: Credentials) -> Self {
        let base = base_url
            .map(|b| b.trim().trim_end_matches('/').to_string())
            .filter(|b| !b.is_empty())
            .unwrap_or_else(|| DEFAULT_BASE_URL.to_string());
        Self {
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(120))
                .build()
                .expect("reqwest client"),
            base_url: base,
            creds: Arc::new(Mutex::new(creds)),
        }
    }

    /// Huidige inloggegevens (kan door een refresh zijn vernieuwd).
    pub fn credentials(&self) -> Credentials {
        self.creds.lock().expect("creds lock").clone()
    }

    fn token(&self) -> String {
        self.creds.lock().expect("creds lock").access_token.clone()
    }

    /// Wisselt het refresh-token voor een nieuw access-token. Geeft `false` als
    /// dat niet kan (geen refresh-token, of de service weigert).
    async fn refresh(&self) -> bool {
        let (refresh_token, client_id) = {
            let creds = self.creds.lock().expect("creds lock");
            (creds.refresh_token.clone(), creds.client_id.clone())
        };
        let Some(refresh_token) = refresh_token else {
            return false;
        };
        match oauth::refresh(&self.base_url, &refresh_token, client_id.as_deref()).await {
            Ok(fresh) => {
                *self.creds.lock().expect("creds lock") = fresh;
                true
            }
            Err(_) => false,
        }
    }

    /// POST met bearer-token; bij een 401 wordt één keer ververst en opnieuw geprobeerd,
    /// zodat een verlopen access-token niet meteen om een nieuwe login vraagt.
    async fn post_authorized(&self, url: &str, body: &serde_json::Value) -> Result<String, AnalyticsError> {
        let mut attempted_refresh = false;
        loop {
            let resp = self
                .http
                .post(url)
                .bearer_auth(self.token())
                .json(body)
                .send()
                .await?;
            let status = resp.status().as_u16();
            let text = resp.text().await.unwrap_or_default();

            if status == 401 && !attempted_refresh {
                attempted_refresh = true;
                if self.refresh().await {
                    continue;
                }
            }
            if !(200..300).contains(&status) {
                return Err(AnalyticsError(format!("HTTP {status}: {}", error_message(&text))));
            }
            return Ok(text);
        }
    }

    /// `POST /query` — dezelfde vorm als voorheen, maar de veldnamen gaan als
    /// JSON-body mee in plaats van als query-string.
    pub async fn get_data(&self, p: &QueryParams) -> Result<QueryResult, AnalyticsError> {
        let url = format!("{}/query", self.base_url);

        let mut fields = p.fields.clone();
        for g in &p.group_by {
            if !fields.contains(g) {
                fields.push(g.clone());
            }
        }

        let body = serde_json::json!({
            "connector": p.connector,
            "account": p.account,
            "fields": fields,
            "date_from": p.date_from,
            "date_to": p.date_to,
            "group_by": p.group_by,
            "options": p.options,
            "limit": p.limit,
        });

        let text = self.post_authorized(&url, &body).await.map_err(|e| {
            AnalyticsError(format!(
                "Databron-fout bij POST {url} connector={} fields={} — {}",
                p.connector,
                fields.join(","),
                e.0
            ))
        })?;

        let parsed: serde_json::Value = serde_json::from_str(&text)?;
        if let Some(err) = parsed.get("error").filter(|e| !e.is_null()) {
            return Err(AnalyticsError(format!("Databron-fout: {err}")));
        }
        let rows = parsed
            .get("data")
            .and_then(|d| d.as_array())
            .cloned()
            .unwrap_or_default();
        Ok(QueryResult { rows })
    }

    /// `POST /action` — pauzeren/activeren, negative keywords, budget.
    pub async fn execute_action(
        &self,
        connector: &str,
        account: &str,
        action: &str,
        params: &serde_json::Value,
    ) -> Result<serde_json::Value, AnalyticsError> {
        let url = format!("{}/action", self.base_url);
        let body = serde_json::json!({
            "connector": connector,
            "account": account,
            "action": action,
            "params": params,
        });

        let text = self.post_authorized(&url, &body).await.map_err(|e| {
            AnalyticsError(format!(
                "Databron-fout bij POST {url} action={action} — {}",
                e.0
            ))
        })?;
        Ok(serde_json::from_str(&text)?)
    }

    /// `GET /health` — gebruikt door de knop "Verbinding testen" in Instellingen.
    pub async fn health(&self) -> Result<String, AnalyticsError> {
        let url = format!("{}/health", self.base_url);
        let resp = self.http.get(&url).send().await?;
        let status = resp.status().as_u16();
        let text = resp.text().await.unwrap_or_default();
        if !(200..300).contains(&status) {
            return Err(AnalyticsError(format!(
                "Databron-fout ({status}) bij GET {url} — {}",
                shorten(&text)
            )));
        }
        let version = serde_json::from_str::<serde_json::Value>(&text)
            .ok()
            .and_then(|v| v.get("version").and_then(|x| x.as_str()).map(|s| s.to_string()))
            .unwrap_or_else(|| "onbekend".to_string());
        Ok(version)
    }
}
