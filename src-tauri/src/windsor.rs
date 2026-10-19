use serde::{Deserialize, Serialize};

const WINDSOR_BASE_URL: &str = "https://connectors.windsor.ai";

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
pub struct WindsorError(pub String);

impl std::fmt::Display for WindsorError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl From<reqwest::Error> for WindsorError {
    fn from(e: reqwest::Error) -> Self {
        WindsorError(format!("Netwerkfout: {e}"))
    }
}

impl From<serde_json::Error> for WindsorError {
    fn from(e: serde_json::Error) -> Self {
        WindsorError(format!("Ongeldige API-reactie: {e}"))
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

    pub async fn get_data(&self, p: &QueryParams) -> Result<QueryResult, WindsorError> {
        let url = format!("{}/{}", WINDSOR_BASE_URL, p.connector);

        let mut fields = p.fields.clone();
        for g in &p.group_by {
            if !fields.contains(g) {
                fields.push(g.clone());
            }
        }

        let mut query: Vec<(String, String)> = vec![
            ("api_key".into(), self.api_key.clone()),
            ("fields".into(), fields.join(",")),
        ];
        if let Some(from) = &p.date_from {
            query.push(("date_from".into(), from.clone()));
        }
        if let Some(to) = &p.date_to {
            query.push(("date_to".into(), to.clone()));
        }
        if !p.account.trim().is_empty() {
            query.push(("select_accounts".into(), p.account.trim().to_string()));
        }
        if let Some(limit) = p.limit {
            query.push(("_max_rows".into(), limit.to_string()));
        }
        if let Some(serde_json::Value::Object(opts)) = &p.options {
            for (key, value) in opts {
                let value_str = match value {
                    serde_json::Value::String(s) => s.clone(),
                    serde_json::Value::Bool(b) => b.to_string(),
                    other => other.to_string(),
                };
                query.push((key.clone(), value_str));
            }
        }

        let resp = self.http.get(&url).query(&query).send().await?;
        let status = resp.status().as_u16();
        let text = resp.text().await.unwrap_or_default();
        if !(200..300).contains(&status) {
            let short = if text.len() > 400 { format!("{}…", &text[..400]) } else { text };
            return Err(WindsorError(format!(
                "Windsor API-fout ({status}) bij GET {url}?fields={} — {short}",
                fields.join(",")
            )));
        }

        let parsed: serde_json::Value = serde_json::from_str(&text)?;
        if parsed.get("error").is_some() {
            return Err(WindsorError(format!(
                "Windsor API-fout: {}",
                parsed["error"]
            )));
        }
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
        let url = format!("{}/{}/actions", WINDSOR_BASE_URL, connector);
        let body = serde_json::json!({
            "account": account,
            "action": action,
            "params": params,
        });

        let resp = self
            .http
            .post(&url)
            .query(&[("api_key", self.api_key.as_str())])
            .json(&body)
            .send()
            .await?;
        let status = resp.status().as_u16();
        let text = resp.text().await.unwrap_or_default();
        if !(200..300).contains(&status) {
            let short = if text.len() > 400 { format!("{}…", &text[..400]) } else { text };
            return Err(WindsorError(format!(
                "Windsor API-fout ({status}) bij POST {url} action={action} — {short}"
            )));
        }
        Ok(serde_json::from_str(&text)?)
    }
}
