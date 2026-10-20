//! DataForSEO: concurrent-keyword-gap via de Labs API.
//!
//! Elke taak kost geld ( ongeveer $0,012 per taak plus $0,00012 per keyword),
//! dus we doen precies één taak per domein en tonen de werkelijke kosten die
//! DataForSEO in de respons teruggeeft.

use serde::Serialize;
use std::time::Duration;

const ENDPOINT: &str =
    "https://api.dataforseo.com/v3/dataforseo_labs/google/ranked_keywords/live";
const LOCATION_NL: u32 = 2528;

#[derive(Serialize, Clone)]
pub struct GapRow {
    pub keyword: String,
    pub volume: u64,
    /// Positie per domein, in dezelfde volgorde als `domains`. `None` = rankt daar niet.
    pub ranks: Vec<Option<u32>>,
}

#[derive(Serialize)]
pub struct GapResult {
    pub domains: Vec<String>,
    pub rows: Vec<GapRow>,
    pub cost: f64,
    /// Aantal gevonden keywords per domein, in dezelfde volgorde als `domains`.
    pub found: Vec<usize>,
    pub gap_volume: u64,
}

struct Ranked {
    keyword: String,
    volume: u64,
    rank: Option<u32>,
}

fn normalize_domain(value: &str) -> String {
    let trimmed = value.trim().trim_end_matches('/');
    let without_scheme = trimmed
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_start_matches("www.");
    without_scheme.split('/').next().unwrap_or("").to_lowercase()
}

/// Haalt de ranked keywords van één domein op.
async fn ranked_keywords(
    client: &reqwest::Client,
    login: &str,
    password: &str,
    target: &str,
    limit: u32,
) -> Result<(Vec<Ranked>, f64), String> {
    let payload = serde_json::json!([{
        "target": target,
        "location_code": LOCATION_NL,
        "language_code": "nl",
        "limit": limit,
        "include_serp_info": false,
        "load_rank_absolute": true,
        "order_by": ["keyword_data.keyword_info.search_volume,desc"]
    }]);

    let response = client
        .post(ENDPOINT)
        .basic_auth(login, Some(password))
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("DataForSEO niet bereikbaar: {e}"))?;

    let status = response.status();
    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Onleesbaar antwoord van DataForSEO: {e}"))?;

    if !status.is_success() {
        let message = body["status_message"].as_str().unwrap_or("onbekende fout");
        return Err(format!("DataForSEO gaf status {status}: {message}"));
    }

    let code = body["status_code"].as_i64().unwrap_or(0);
    if code != 20000 {
        let message = body["status_message"].as_str().unwrap_or("onbekende fout");
        return Err(format!("DataForSEO: {message} (code {code})"));
    }

    let cost = body["cost"].as_f64().unwrap_or(0.0);
    let task = &body["tasks"][0];
    let task_code = task["status_code"].as_i64().unwrap_or(0);
    if task_code != 20000 {
        let message = task["status_message"].as_str().unwrap_or("onbekende fout");
        return Err(format!("DataForSEO-taak mislukt: {message} (code {task_code})"));
    }

    let mut out: Vec<Ranked> = Vec::new();
    if let Some(items) = task["result"][0]["items"].as_array() {
        for item in items {
            let Some(keyword) = item["keyword_data"]["keyword"].as_str() else { continue };
            let volume = item["keyword_data"]["keyword_info"]["search_volume"]
                .as_u64()
                .unwrap_or(0);
            let serp = &item["ranked_serp_element"]["serp_item"];
            let rank = serp["rank_absolute"]
                .as_u64()
                .or_else(|| serp["rank_group"].as_u64())
                .map(|value| value as u32);
            out.push(Ranked { keyword: keyword.to_string(), volume, rank });
        }
    }
    Ok((out, cost))
}

/// Vergelijkt het eigen domein met concurrenten en levert de keywords op waar
/// een concurrent wel rankt en het eigen domein niet.
pub async fn gap(
    login: &str,
    password: &str,
    domains: &[String],
    limit: u32,
) -> Result<GapResult, String> {
    if domains.len() < 2 {
        return Err("Vul je eigen domein en minimaal één concurrent in.".to_string());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;

    let mut cleaned: Vec<String> = Vec::new();
    for domain in domains {
        let value = normalize_domain(domain);
        if value.is_empty() {
            continue;
        }
        if !cleaned.contains(&value) {
            cleaned.push(value);
        }
    }
    if cleaned.len() < 2 {
        return Err("Vul je eigen domein en minimaal één concurrent in.".to_string());
    }

    let mut cost = 0.0;
    let mut found: Vec<usize> = Vec::new();
    // keyword -> positie per domein
    let mut ranks: std::collections::HashMap<String, (u64, Vec<Option<u32>>)> =
        std::collections::HashMap::new();

    for (index, domain) in cleaned.iter().enumerate() {
        let (keywords, spent) = ranked_keywords(&client, login, password, domain, limit).await?;
        cost += spent;
        found.push(keywords.len());
        for entry in keywords {
            let slot = ranks
                .entry(entry.keyword)
                .or_insert_with(|| (entry.volume, vec![None; cleaned.len()]));
            if entry.volume > slot.0 {
                slot.0 = entry.volume;
            }
            slot.1[index] = entry.rank;
        }
    }

    let mut rows: Vec<GapRow> = ranks
        .into_iter()
        .filter(|(_, (_, positions))| {
            // Gap = het eigen domein rankt niet, minstens één concurrent wel.
            positions[0].is_none() && positions.iter().skip(1).any(|rank| rank.is_some())
        })
        .map(|(keyword, (volume, ranks))| GapRow { keyword, volume, ranks })
        .collect();
    rows.sort_by(|a, b| b.volume.cmp(&a.volume).then(a.keyword.cmp(&b.keyword)));
    rows.truncate(300);
    let gap_volume = rows.iter().map(|row| row.volume).sum();

    Ok(GapResult { domains: cleaned, rows, cost, found, gap_volume })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maakt_domeinen_schoon() {
        assert_eq!(normalize_domain("https://www.White-Vision.nl/"), "white-vision.nl");
        assert_eq!(normalize_domain(" white-vision.nl "), "white-vision.nl");
        assert_eq!(normalize_domain("http://example.com/pad/"), "example.com");
    }
}
