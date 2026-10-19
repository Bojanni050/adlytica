use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const WINDSOR_API_URL: &str = "https://connectors.windsor.ai/api/v2/connector-management";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WindsorConfig {
    pub api_key: String,
    #[serde(default)]
    pub accounts: HashMap<String, String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct QueryParams {
    pub connector: String,
    pub account: String,
    pub fields: Vec<String>,
    pub date_from: Option<String>,
    pub date_to: Option<String>,
    pub group_by: Vec<String>,
    pub options: Option<serde_json::Value>,
    pub limit: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct QueryResult {
    pub rows: Vec<serde_json::Value>,
}

#[derive(Debug)]
pub struct WindsorError {
    pub message: String,
}

impl std::fmt::Display for WindsorError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl From<reqwest::Error> for WindsorError {
    fn from(e: reqwest::Error) -> Self {
        WindsorError { message: format!("Netwerkfout: {e}") }
    }
}

impl From<serde_json::Error> for WindsorError {
    fn from(e: serde_json::Error) -> Self {
        WindsorError { message: format!("Ongeldige API-reactie: {e}") }
    }
}

pub struct WindsorClient {
    http: reqwest::Client,
    api_key: String,
}

impl WindsorClient {
    pub fn new(api_key: String) -> Self {
        Self {
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(120))
                .build()
                .expect("reqwest client"),
            api_key,
        }
    }

    async fn post(&self, path: &str, body: &serde_json::Value) -> Result<reqwest::Response, WindsorError> {
        let url = format!("{}/{}", WINDSOR_API_URL, path);
        Ok(self
            .http
            .post(&url)
            .query(&[("api_key", &self.api_key)])
            .json(body)
            .send()
            .await?)
    }

    pub async fn get_data(&self, p: &QueryParams) -> Result<QueryResult, WindsorError> {
        let mut body = serde_json::json!({
            "connector": p.connector,
            "account": p.account,
            "fields": p.fields,
        });
        if let Some(from) = &p.date_from {
            body["date_from"] = serde_json::json!(from);
            body["date_to"] = serde_json::json!(p.date_to.clone().unwrap_or_else(|| "today".into()));
        }
        if !p.group_by.is_empty() {
            body["group_by"] = serde_json::json!(p.group_by);
        }
        if let Some(opts) = &p.options {
            body["options"] = opts.clone();
        }
        if let Some(limit) = p.limit {
            body["limit"] = serde_json::json!(limit);
        }

        let resp = self.post("query", &body).await?;
        let status = resp.status().as_u16();
        let text = resp.text().await.unwrap_or_default();
        if !(200..300).contains(&status) {
            return Err(WindsorError { message: format!("Windsor API-fout ({status}): {text}") });
        }
        let parsed: serde_json::Value = serde_json::from_str(&text)?;
        let rows = parsed
            .get("data")
            .and_then(|d| d.as_array())
            .cloned()
            .unwrap_or_default();
        Ok(QueryResult { rows })
    }

    pub async fn execute_action(
        &self,
        connector: &str,
        account: &str,
        action: &str,
        params: &serde_json::Value,
    ) -> Result<serde_json::Value, WindsorError> {
        let body = serde_json::json!({
            "connector": connector,
            "account": account,
            "action": action,
            "params": params,
        });
        let resp = self.post("actions/execute", &body).await?;
        let status = resp.status().as_u16();
        let text = resp.text().await.unwrap_or_default();
        if !(200..300).contains(&status) {
            return Err(WindsorError { message: format!("Windsor API-fout ({status}): {text}") });
        }
        Ok(serde_json::from_str(&text)?)
    }
}
