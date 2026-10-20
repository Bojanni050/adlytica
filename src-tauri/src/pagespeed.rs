//! PageSpeed Insights: haalt de Lighthouse-scores en de belangrijkste
//! verbeterpunten op via de gratis Google API (één key, quotum per dag).

use serde::Serialize;
use std::time::Duration;

const ENDPOINT: &str = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

#[derive(Serialize, Debug)]
pub struct Scores {
    pub performance: u8,
    pub accessibility: u8,
    pub best_practices: u8,
    pub seo: u8,
}

#[derive(Serialize, Debug)]
pub struct Metric {
    pub key: String,
    pub label: String,
    pub value: String,
    pub score: u8,
}

#[derive(Serialize, Debug)]
pub struct Opportunity {
    pub title: String,
    pub description: String,
    pub savings_ms: u64,
}

#[derive(Serialize, Debug)]
pub struct PageSpeedResult {
    pub url: String,
    pub strategy: String,
    pub scores: Scores,
    pub metrics: Vec<Metric>,
    pub opportunities: Vec<Opportunity>,
    pub fetched_at: String,
}

fn score_of(value: &serde_json::Value) -> u8 {
    value
        .as_f64()
        .map(|score| (score * 100.0).round().clamp(0.0, 100.0) as u8)
        .unwrap_or(0)
}

/// Zet het Lighthouse-antwoord om naar alleen de cijfers die de UI toont.
fn parse(body: &str, url: &str, strategy: &str) -> Result<PageSpeedResult, String> {
    let value: serde_json::Value =
        serde_json::from_str(body).map_err(|_| "Onverwacht antwoord van PageSpeed.".to_string())?;
    let lighthouse = value.get("lighthouseResult").ok_or_else(|| {
        value
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(|m| m.as_str())
            .unwrap_or("PageSpeed gaf geen resultaat terug.")
            .to_string()
    })?;

    let categories = &lighthouse["categories"];
    let scores = Scores {
        performance: score_of(&categories["performance"]["score"]),
        accessibility: score_of(&categories["accessibility"]["score"]),
        best_practices: score_of(&categories["best-practices"]["score"]),
        seo: score_of(&categories["seo"]["score"]),
    };

    let audits = &lighthouse["audits"];
    let wanted = [
        ("first-contentful-paint", "Eerste weergave"),
        ("largest-contentful-paint", "Grootste element"),
        ("total-blocking-time", "Blokkerende tijd"),
        ("cumulative-layout-shift", "Layoutverschuiving"),
        ("speed-index", "Snelheidsindex"),
        ("server-response-time", "Serverreactie"),
    ];
    let metrics: Vec<Metric> = wanted
        .iter()
        .filter_map(|(key, label)| {
            let audit = audits.get(*key)?;
            let value = audit.get("displayValue")?.as_str()?.to_string();
            Some(Metric {
                key: key.to_string(),
                label: label.to_string(),
                value,
                score: score_of(&audit["score"]),
            })
        })
        .collect();

    let mut opportunities: Vec<Opportunity> = audits
        .as_object()
        .map(|map| {
            map.iter()
                .filter_map(|(_, audit)| {
                    let savings = audit.get("details")?.get("overallSavingsMs")?.as_f64()?;
                    if savings < 50.0 {
                        return None;
                    }
                    Some(Opportunity {
                        title: audit.get("title")?.as_str()?.to_string(),
                        description: audit
                            .get("description")
                            .and_then(|d| d.as_str())
                            .unwrap_or("")
                            .to_string(),
                        savings_ms: savings.round() as u64,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    opportunities.sort_by(|a, b| b.savings_ms.cmp(&a.savings_ms));
    opportunities.truncate(8);

    Ok(PageSpeedResult {
        url: url.to_string(),
        strategy: strategy.to_string(),
        scores,
        metrics,
        opportunities,
        fetched_at: crate::audit::now_stamp(),
    })
}

pub async fn measure(url: &str, key: &str, strategy: &str) -> Result<PageSpeedResult, String> {
    let trimmed = url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("Vul een pagina-adres in.".to_string());
    }
    let target = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    let strategy = if strategy == "desktop" { "desktop" } else { "mobile" };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(90))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get(ENDPOINT)
        .query(&[
            ("url", target.as_str()),
            ("key", key),
            ("strategy", strategy),
            ("category", "performance"),
            ("category", "accessibility"),
            ("category", "best-practices"),
            ("category", "seo"),
        ])
        .send()
        .await
        .map_err(|e| format!("PageSpeed is niet bereikbaar: {e}"))?;

    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        let message = serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .and_then(|value| {
                value
                    .get("error")
                    .and_then(|e| e.get("message"))
                    .and_then(|m| m.as_str())
                    .map(|m| m.to_string())
            })
            .unwrap_or_else(|| format!("PageSpeed gaf status {status}."));
        return Err(message);
    }
    parse(&body, &target, strategy)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"{
      "lighthouseResult": {
        "categories": {
          "performance": {"score": 0.45},
          "accessibility": {"score": 0.9},
          "best-practices": {"score": 0.83},
          "seo": {"score": 1}
        },
        "audits": {
          "first-contentful-paint": {"score": 0.9, "displayValue": "1,2 s"},
          "largest-contentful-paint": {"score": 0.2, "displayValue": "6,4 s"},
          "render-blocking-resources": {
            "title": "Eliminate render-blocking resources",
            "description": "Resources are blocking the first paint.",
            "details": {"type": "opportunity", "overallSavingsMs": 1240}
          },
          "unused-css-rules": {
            "title": "Reduce unused CSS",
            "description": "",
            "details": {"type": "opportunity", "overallSavingsMs": 300}
          },
          "uses-http2": {"title": "Use HTTP/2", "description": "", "details": {"type": "debugdata"}}
        }
      }
    }"#;

    #[test]
    fn leest_scores_en_kansen_uit() {
        let result = parse(SAMPLE, "https://example.com", "mobile").expect("parse");
        assert_eq!(result.scores.performance, 45);
        assert_eq!(result.scores.seo, 100);
        assert_eq!(result.metrics.len(), 2);
        assert_eq!(result.opportunities.len(), 2);
        assert_eq!(result.opportunities[0].savings_ms, 1240);
    }

    #[test]
    fn geeft_de_foutmelding_van_google_terug() {
        let body = r#"{"error": {"message": "API key not valid."}}"#;
        let error = parse(body, "https://example.com", "mobile").unwrap_err();
        assert_eq!(error, "API key not valid.");
    }
}
