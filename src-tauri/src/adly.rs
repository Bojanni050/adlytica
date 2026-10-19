use serde::{Deserialize, Serialize};

const MISTRAL_API_URL: &str = "https://api.mistral.ai/v1/chat/completions";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
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

pub fn system_prompt(context: &Option<String>) -> String {
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
EEN-KLIK ACTIES: de app kan Google Ads-wijzigingen direct uitvoeren. Wanneer de gebruiker \
jou vraagt een campagne te pauzeren of te activeren, het dagbudget te wijzigen of de \
biedstrategie aan te passen, leg dan kort uit wat je gaat doen en voeg daarna precies een \
actieblok toe op een eigen regel, exact in dit formaat: \
[[ACTION]] {\"action\": \"...\", \"label\": \"...\", \"params\": {...}} \
Beschikbare acties: \
pause_campaign (params: campaign_id), \
enable_campaign (params: campaign_id), \
set_campaign_budget (params: campaign_id, budget_type \"daily\" of \"lifetime\", amount in euro als getal), \
set_campaign_bidding_strategy (params: campaign_id, strategy een van manual_cpc, target_cpa, target_roas, maximize_conversions, maximize_conversion_value, maximize_clicks; plus target_cpa in euro bij target_cpa/maximize_conversions, target_roas als ratio bij target_roas/maximize_conversion_value, of cpc_bid_ceiling in euro bij maximize_clicks). \
Gebruik altijd de campaign_id uit de meegestuurde datacontext. Als die niet beschikbaar is, \
vraag dan om bevestiging van de campagne voordat je een actieblok maakt. \
Maak alleen een actieblok als de gebruiker er expliciet om vraagt of duidelijk akkoord gaat. \
Voer nooit meerdere tegenstrijdige wijzigingen op dezelfde campagne uit in een antwoord.",
    );
    if let Some(ctx) = context {
        if !ctx.trim().is_empty() {
            prompt.push_str("\n\nActuele data uit de app (gebruik dit als basis voor je advies):\n");
            prompt.push_str(ctx);
        }
    }
    prompt
}
