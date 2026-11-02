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
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

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

/// Hoe lang een queryresultaat hergebruikt mag worden. Vijf minuten is kort
/// genoeg om het "nu" te mogen noemen en lang genoeg om heen-en-weer klikken
/// tussen views geen nieuwe request te laten kosten.
pub const CACHE_TTL_SECS: u64 = 300;

/// Stabiele sleutel voor de cache: dezelfde vraag levert altijd dezelfde
/// string op. `date_to` zonder waarde telt als vandaag, want dat is wat er
/// uiteindelijk naar de service gaat.
pub fn cache_key(p: &QueryParams) -> String {
    let mut fields = p.fields.clone();
    for group in &p.group_by {
        if !fields.contains(group) {
            fields.push(group.clone());
        }
    }
    serde_json::json!({
        "connector": p.connector,
        "account": p.account,
        "fields": fields,
        "date_from": p.date_from,
        "date_to": p.date_to.clone().unwrap_or_else(today_utc),
        "group_by": p.group_by,
        "options": p.options,
        "limit": p.limit,
    })
    .to_string()
}

#[derive(Debug, Serialize)]
pub struct CacheStats {
    pub entries: usize,
    pub hits: u64,
    pub misses: u64,
    pub ttl_seconds: u64,
}

#[derive(Debug)]
struct CacheEntry {
    rows: Vec<serde_json::Value>,
    stored_at: Instant,
}

/// Kleine in-memory cache per vraag (connector, account, velden, datumbereik).
/// Bewust in het geheugen en niet op schijf: na een herstart is ophalen bij de
/// bron de enige juiste stap.
#[derive(Debug, Default)]
pub struct QueryCache {
    entries: HashMap<String, CacheEntry>,
    hits: u64,
    misses: u64,
}

impl QueryCache {
    fn ttl() -> Duration {
        Duration::from_secs(CACHE_TTL_SECS)
    }

    pub fn get(&mut self, key: &str) -> Option<Vec<serde_json::Value>> {
        let fresh = self
            .entries
            .get(key)
            .map(|entry| entry.stored_at.elapsed() < Self::ttl())
            .unwrap_or(false);
        if fresh {
            self.hits += 1;
            return self.entries.get(key).map(|entry| entry.rows.clone());
        }
        // Verlopen of onbekend: opruimen en als miss tellen.
        self.entries.remove(key);
        self.misses += 1;
        None
    }

    pub fn put(&mut self, key: String, rows: Vec<serde_json::Value>) {
        // Verlopen rijen meteen opruimen, zodat de cache niet groeit met
        // datumbereiken die je nooit meer opvraagt.
        let ttl = Self::ttl();
        self.entries.retain(|_, entry| entry.stored_at.elapsed() < ttl);
        self.entries.insert(
            key,
            CacheEntry {
                rows,
                stored_at: Instant::now(),
            },
        );
    }

    pub fn clear(&mut self) -> usize {
        let removed = self.entries.len();
        self.entries.clear();
        removed
    }

    pub fn stats(&self) -> CacheStats {
        CacheStats {
            entries: self.entries.len(),
            hits: self.hits,
            misses: self.misses,
            ttl_seconds: CACHE_TTL_SECS,
        }
    }
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

/// Vandaag (UTC) als `YYYY-MM-DD`. Zonder chrono: de service eist `date_from`
/// én `date_to`, bijna elke view stuurt alleen `date_from` — dan is "tot nu"
/// de enige logische vulling. Uur-afwijking rond middernacht (UTC i.p.v.
/// lokale tijd) is voor analytics-bereiken onbeduidend.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    // Howard Hinnant's civil_from_days: dagen sinds epoch → (jaar, maand, dag).
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m as u32, d as u32)
}

pub(crate) fn today_utc() -> String {
    let days = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64 / 86_400)
        .unwrap_or(0);
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02}")
}

/// Volledige UTC-tijd als ISO-8601, zonder extra dependency.
pub(crate) fn utc_now_iso() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let (y, m, d) = civil_from_days(secs.div_euclid(86_400));
    let rest = secs.rem_euclid(86_400);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        rest / 3600,
        (rest % 3600) / 60,
        rest % 60
    )
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

        let date_to = p.date_to.clone().unwrap_or_else(today_utc);
        let date_from = p.date_from.clone();
        let body = serde_json::json!({
            "connector": p.connector,
            "account": p.account,
            "fields": fields,
            "date_from": date_from,
            "date_to": date_to,
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

#[cfg(test)]
mod tests {
    use super::{cache_key, civil_from_days, QueryCache, QueryParams};

    fn params(date_from: &str, date_to: Option<&str>) -> QueryParams {
        QueryParams {
            connector: "searchconsole".into(),
            account: "sc-domain:example.nl".into(),
            fields: vec!["date".into(), "clicks".into()],
            date_from: Some(date_from.into()),
            date_to: date_to.map(|value| value.to_string()),
            group_by: vec!["date".into()],
            options: None,
            limit: Some(500),
        }
    }

    #[test]
    fn cache_sleutel_is_stabiel_en_periode_gevoelig() {
        let first = cache_key(&params("2026-10-01", Some("2026-10-31")));
        let second = cache_key(&params("2026-10-01", Some("2026-10-31")));
        let other = cache_key(&params("2026-09-01", Some("2026-10-31")));
        assert_eq!(first, second);
        assert_ne!(first, other);
    }

    #[test]
    fn cache_sleutel_behandelt_lege_date_to_als_vandaag() {
        let empty = cache_key(&params("2026-10-01", None));
        let explicit = cache_key(&params("2026-10-01", Some(&super::today_utc())));
        assert_eq!(empty, explicit);
    }

    #[test]
    fn cache_onthoudt_resultaten_en_telt_hits() {
        let mut cache = QueryCache::default();
        assert!(cache.get("vraag").is_none());
        assert_eq!(cache.stats().misses, 1);

        cache.put("vraag".to_string(), vec![serde_json::json!({"clicks": 1})]);
        let hit = cache.get("vraag").expect("hit");
        assert_eq!(hit.len(), 1);
        assert_eq!(cache.stats().hits, 1);
        assert_eq!(cache.stats().entries, 1);

        assert_eq!(cache.clear(), 1);
        assert!(cache.get("vraag").is_none());
        assert_eq!(cache.stats().entries, 0);
    }

    #[test]
    fn civil_from_days_datums() {
        // epoch: 1970-01-01
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        // grens vóór 1970
        assert_eq!(civil_from_days(-1), (1969, 12, 31));
        // schrikkeljaar: 2000-02-29 = dag 11_016
        assert_eq!(civil_from_days(11_016), (2000, 2, 29));
        // 56 jaar (14 schrikkeljaren) = 20_454 dagen tot 2026-01-01, + 304 tot 2026-11-01
        assert_eq!(civil_from_days(20_758), (2026, 11, 1));
    }
}
