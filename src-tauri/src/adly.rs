use serde::{Deserialize, Serialize};

const MISTRAL_API_URL: &str = "https://api.mistral.ai/v1/chat/completions";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

/// Eén stuk bewijs dat de assistent mag gebruiken, inclusief herkomst.
///
/// De rijen gaan als tekst mee (geen getallen): zo kan het model niets
/// herrekenen en blijft elk cijfer in het antwoord herleidbaar tot een bron.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AdlySource {
    /// Nummer zoals het in het antwoord terugkomt: [1], [2], …
    pub id: usize,
    pub label: String,
    pub connector: String,
    #[serde(default)]
    pub account: String,
    #[serde(default)]
    pub date_from: String,
    #[serde(default)]
    pub date_to: String,
    #[serde(default)]
    pub fields: Vec<String>,
    #[serde(default)]
    pub rows: Vec<Vec<String>>,
    /// Totaal aantal rijen in de bron; `rows` kan afgekapt zijn.
    #[serde(default)]
    pub total_rows: usize,
}

const MAX_SOURCES: usize = 6;
const MAX_SOURCE_ROWS: usize = 40;
const MAX_CELL_CHARS: usize = 60;

/// Maakt van de bronnen een compact, genummerd dossier voor het model.
pub fn format_sources(sources: &[AdlySource]) -> String {
    let mut out = String::new();
    for source in sources.iter().take(MAX_SOURCES) {
        let period = if source.date_from.is_empty() && source.date_to.is_empty() {
            String::new()
        } else {
            format!(" · {} t/m {}", source.date_from, source.date_to)
        };
        let account = if source.account.is_empty() {
            String::new()
        } else {
            format!(" · {}", source.account)
        };
        let total = source.total_rows.max(source.rows.len());
        out.push_str(&format!(
            "\n[{}] {}{} · {}{} · {} van {} rijen\n",
            source.id,
            source.label,
            account,
            source.connector,
            period,
            source.rows.len().min(MAX_SOURCE_ROWS),
            total
        ));
        if !source.fields.is_empty() {
            out.push_str(&format!("kolommen: {}\n", source.fields.join(" | ")));
        }
        for row in source.rows.iter().take(MAX_SOURCE_ROWS) {
            let cells: Vec<String> = row
                .iter()
                .map(|cell| {
                    let trimmed = cell.trim();
                    if trimmed.chars().count() > MAX_CELL_CHARS {
                        let cut: String = trimmed.chars().take(MAX_CELL_CHARS).collect();
                        format!("{cut}…")
                    } else {
                        trimmed.to_string()
                    }
                })
                .collect();
            out.push_str(&format!("{}\n", cells.join(" | ")));
        }
    }
    out
}

#[derive(Debug)]
pub struct AdlyError(pub String);

impl std::fmt::Display for AdlyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl From<reqwest::Error> for AdlyError {
    fn from(e: reqwest::Error) -> Self {
        AdlyError(format!("Netwerkfout: {e}"))
    }
}

impl From<serde_json::Error> for AdlyError {
    fn from(e: serde_json::Error) -> Self {
        AdlyError(format!("Ongeldige API-reactie: {e}"))
    }
}

pub struct AdlyClient {
    http: reqwest::Client,
    api_key: String,
}

#[derive(Serialize)]
struct ApiMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Deserialize)]
struct ApiResponse {
    #[serde(default)]
    choices: Vec<ApiChoice>,
}

#[derive(Deserialize)]
struct ApiChoice {
    message: ApiChoiceMessage,
}

#[derive(Deserialize)]
struct ApiChoiceMessage {
    #[serde(default)]
    content: String,
}

impl AdlyClient {
    pub fn new(api_key: String) -> Self {
        Self {
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(120))
                .build()
                .expect("reqwest client"),
            api_key,
        }
    }

    pub async fn chat(
        &self,
        model: &str,
        system: &str,
        messages: &[ChatMessage],
    ) -> Result<String, AdlyError> {
        let mut api_messages = vec![ApiMessage { role: "system", content: system }];
        for m in messages {
            api_messages.push(ApiMessage { role: m.role.as_str(), content: m.content.as_str() });
        }

        let body = serde_json::json!({
            "model": model,
            "messages": api_messages,
            "temperature": 0.4,
            "max_tokens": 1200,
        });

        let resp = self
            .http
            .post(MISTRAL_API_URL)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .json(&body)
            .send()
            .await?;
        let status = resp.status().as_u16();
        let text = resp.text().await.unwrap_or_default();
        if !(200..300).contains(&status) {
            let short = if text.len() > 400 { format!("{}…", &text[..400]) } else { text };
            return Err(AdlyError(format!("Mistral API-fout ({status}): {short}")));
        }

        let parsed: ApiResponse = serde_json::from_str(&text)?;
        parsed
            .choices
            .into_iter()
            .next()
            .map(|c| c.message.content)
            .ok_or_else(|| AdlyError("Leeg antwoord van Mistral API".into()))
    }
}

pub fn system_prompt(context: &Option<String>, sources: &[AdlySource]) -> String {
    let mut prompt = String::from(
        "Je bent Adly, de ingebouwde AI-assistent van de Adlytica-desktopapp. \
Je helpt een Nederlands marketingteam (White Vision, white-vision.nl) met SEO-analyse en \
Google Ads-campagnes: zoekwoordkansen inschatten, on-page SEO-advies geven, campagnestructuren \
ontwerpen (campagnes, ad groups, responsive search ads met koppen en beschrijvingen), \
budgetten en biedstrategiën adviseren en prestaties interpreteren. \
Antwoord altijd in het Nederlands, beknopt en praktisch: korte tekst, opsommingen en \
concrete volgende stappen. Vraag door naar gegevens als die ontbreken. \
Bedragen zijn in euro's. \
\
EEN-KLIK ACTIES: de app kan een paar Google Ads-wijzigingen direct uitvoeren. Wanneer de gebruiker \
jou vraagt een campagne te pauzeren of te activeren, of negative keywords toe te voegen, leg dan kort \
uit wat je gaat doen en voeg daarna precies een actieblok toe op een eigen regel, exact in dit formaat: \
[[ACTION]] {\"action\": \"...\", \"label\": \"...\", \"params\": {...}} \
Beschikbare acties: \
pause_campaign (params: campaign_id), \
enable_campaign (params: campaign_id), \
push_negative_keywords (params: campaign_id, keywords als lijst met zoektermen). \
Budgetten en biedstrategieën kun je alleen adviseren, niet uitvoeren: daar bestaat geen actieblok voor. \
Gebruik altijd de campaign_id uit de meegestuurde datacontext. Als die niet beschikbaar is, \
vraag dan om bevestiging van de campagne voordat je een actieblok maakt. \
Maak alleen een actieblok als de gebruiker er expliciet om vraagt of duidelijk akkoord gaat. \
Voer nooit meerdere tegenstrijdige wijzigingen op dezelfde campagne uit in een antwoord.",
    );
    prompt.push_str(
        "\n\nBRONVERWIJZING: je krijgt een genummerd brondossier met de cijfers waarover je mag praten. \
Gebruik uitsluitend getallen die letterlijk in dat dossier staan en verwijs achter elke bewering over \
cijfers naar de gebruikte bron met [1], [2], enzovoort. Verzin geen cijfers, geen totalen en geen \
trends die je niet uit het dossier kunt afleiden; reken ook niet zelf nieuwe totalen uit. \
Staat het gevraagde niet in het dossier, zeg dat dan expliciet en vraag om de juiste gegevens. \
Noem in je antwoord kort de periode waarop de cijfers betrekking hebben.",
    );
    if let Some(ctx) = context {
        if !ctx.trim().is_empty() {
            prompt.push_str("\n\nActuele data uit de app (gebruik dit als basis voor je advies):\n");
            prompt.push_str(ctx);
        }
    }
    if !sources.is_empty() {
        prompt.push_str("\n\nBRONDOSSIER (genummerd; dit zijn je enige cijfers):");
        prompt.push_str(&format_sources(sources));
    }
    prompt
}

#[cfg(test)]
mod tests {
    use super::*;

    fn source(id: usize, rows: Vec<Vec<String>>) -> AdlySource {
        AdlySource {
            id,
            label: "Top zoektermen".into(),
            connector: "searchconsole".into(),
            account: "white-vision.nl".into(),
            date_from: "2026-08-05".into(),
            date_to: "2026-11-02".into(),
            fields: vec!["query".into(), "clicks".into()],
            rows,
            total_rows: 312,
        }
    }

    #[test]
    fn brondossier_nummert_en_beperkt_rijen() {
        let rows: Vec<Vec<String>> = (0..50)
            .map(|i| vec![format!("zoekterm {i}"), i.to_string()])
            .collect();
        let dossier = format_sources(&[source(1, rows)]);
        assert!(dossier.contains("[1] Top zoektermen"), "bron moet genummerd zijn");
        assert!(dossier.contains("40 van 312 rijen"), "rijen moeten afgekapt worden");
        assert!(dossier.contains("kolommen: query | clicks"));
        assert!(!dossier.contains("zoekterm 40"), "rij 41 mag niet meegestuurd worden");
    }

    #[test]
    fn lange_cellen_worden_afgekapt() {
        let long = "x".repeat(120);
        let dossier = format_sources(&[source(1, vec![vec![long, "3".into()]])]);
        assert!(dossier.contains('…'), "lange cel moet met ellipsis eindigen");
    }

    #[test]
    fn systeemprompt_eist_bronverwijzing() {
        let prompt = system_prompt(&None, &[source(1, vec![vec!["zwembad".into(), "12".into()]])]);
        assert!(prompt.contains("BRONVERWIJZING"));
        assert!(prompt.contains("BRONDOSSIER"));
        assert!(prompt.contains("[1] Top zoektermen"));
        assert!(prompt.contains("push_negative_keywords"));
        assert!(!prompt.contains("set_campaign_budget"), "niet-uitvoerbare acties horen er niet in");
    }
}
