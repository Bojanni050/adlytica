use serde::{Deserialize, Serialize};

/// Koppeling met de WordPress-site van de klant via de WP-REST-API.
/// Auth gaat met HTTP Basic (gebruikersnaam + applicatiewachtwoord), zodat er
/// geen plugin of OAuth-flow nodig is en het wachtwoord lokaal blijft.
pub struct WordpressClient {
    http: reqwest::Client,
    base: String,
    user: String,
    password: String,
}

#[derive(Debug)]
pub struct WordpressError(pub String);

impl std::fmt::Display for WordpressError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl From<reqwest::Error> for WordpressError {
    fn from(e: reqwest::Error) -> Self {
        WordpressError(format!("Netwerkfout richting WordPress: {e}"))
    }
}

impl From<serde_json::Error> for WordpressError {
    fn from(e: serde_json::Error) -> Self {
        WordpressError(format!("Onverwachte reactie van WordPress: {e}"))
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WpTarget {
    pub id: u64,
    pub post_type: String,
    pub slug: String,
    pub title: String,
    pub permalink: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct WpSeo {
    pub id: u64,
    pub post_type: String,
    pub permalink: String,
    pub title: String,
    pub description: String,
    pub focus_keyword: String,
}

impl WordpressClient {
    pub fn new(base: String, user: String, password: String) -> Self {
        Self {
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .expect("reqwest client"),
            base: normalize_base(&base),
            user,
            password,
        }
    }

    fn url(&self, path: &str) -> String {
        format!("{}/{}", self.base, path.trim_start_matches('/'))
    }

    fn get(&self, path: &str) -> reqwest::RequestBuilder {
        self.http
            .get(self.url(path))
            .basic_auth(&self.user, Some(&self.password))
    }

    fn post(&self, path: &str) -> reqwest::RequestBuilder {
        self.http
            .post(self.url(path))
            .basic_auth(&self.user, Some(&self.password))
    }

    /// Leest de sitenaam uit `/wp-json`, als controle dat URL en inloggegevens kloppen.
    pub async fn ping(&self) -> Result<String, WordpressError> {
        let (status, body) = self.send(self.get("wp-json"), "GET wp-json").await?;
        if status == 401 || status == 403 {
            return Err(WordpressError(
                "WordPress weigert de inloggegevens. Gebruik je gebruikersnaam (niet je e-mailadres) \
                 en een applicatiewachtwoord uit Profiel → Applicatiewachtwoorden."
                    .into(),
            ));
        }
        let name = body
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("WordPress-site");
        Ok(name.to_string())
    }

    /// Zoekt de pagina of het bericht dat bij een URL hoort, via de slug uit het pad.
    pub async fn find_page(&self, page_url: &str) -> Result<WpTarget, WordpressError> {
        let permalink_path = path_from_url(page_url);
        let slug = permalink_path
            .split('/')
            .filter(|s| !s.is_empty())
            .last()
            .unwrap_or("")
            .to_string();
        if slug.is_empty() {
            return Err(WordpressError(format!(
                "Kon geen pagina afleiden uit \"{page_url}\". Gebruik de volledige URL van de pagina."
            )));
        }

        for post_type in ["pages", "posts"] {
            let path = format!("wp-json/wp/v2/{post_type}?slug={}&_fields=id,link,slug,title", encode(&slug));
            let (status, body) = self.send(self.get(&path), "GET zoekopdracht").await?;
            if status == 400 && post_type == "pages" {
                // Sommige installaties hebben geen /pages (bijv. alleen posts); probeer dan posts.
                continue;
            }
            let Some(first) = body.as_array().and_then(|a| a.first()) else {
                continue;
            };
            let id = first.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
            if id == 0 {
                continue;
            }
            return Ok(WpTarget {
                id,
                post_type: post_type.to_string(),
                slug,
                title: rendered(first.get("title")),
                permalink: first
                    .get("link")
                    .and_then(|v| v.as_str())
                    .unwrap_or(page_url)
                    .to_string(),
            });
        }

        Err(WordpressError(format!(
            "Geen pagina of bericht gevonden met slug \"{slug}\" op {}. \
             Staat de pagina gepubliceerd en is de URL goed?",
            self.base
        )))
    }

    /// Leest de huidige Rank Math-velden van een pagina.
    pub async fn get_seo(&self, post_type: &str, id: u64) -> Result<WpSeo, WordpressError> {
        let path = format!(
            "wp-json/wp/v2/{post_type}/{id}?context=edit&_fields=id,link,title,meta"
        );
        let (_, body) = self.send(self.get(&path), "GET pagina").await?;
        Ok(seo_from_json(&body, post_type, id))
    }

    /// Schrijft titel en description naar Rank Math en controleert of ze zijn overgenomen.
    pub async fn set_seo(
        &self,
        post_type: &str,
        id: u64,
        title: &str,
        description: &str,
    ) -> Result<WpSeo, WordpressError> {
        let meta = serde_json::json!({
            "rank_math_title": title,
            "rank_math_description": description,
        });

        // Eerst via de standaard WP-REST; Rank Math registreert deze meta meestal als
        // schrijfbaar. Werkt dat niet, dan via Rank Math's eigen update-route.
        let path = format!("wp-json/wp/v2/{post_type}/{id}");
        let payload = serde_json::json!({ "meta": meta });
        let (status, body) = self
            .send(self.post(&path).json(&payload), "POST pagina")
            .await?;
        if (200..300).contains(&status) {
            let stored = self.get_seo(post_type, id).await?;
            if same(&stored.title, title) && same(&stored.description, description) {
                return Ok(stored);
            }
        } else if status == 401 || status == 403 {
            return Err(WordpressError(format!(
                "WordPress weigert het opslaan ({status}). Controleer of de gebruiker rechten heeft \
                 om deze pagina te bewerken. {}",
                short_body(&body)
            )));
        }

        let rank_math = serde_json::json!({
            "objectType": "post",
            "objectID": id,
            "meta": {
                "rank_math_title": title,
                "rank_math_description": description,
            },
        });
        let (rm_status, rm_body) = self
            .send(
                self.post("wp-json/rankmath/v1/updateMeta").json(&rank_math),
                "POST rankmath/v1/updateMeta",
            )
            .await?;
        if !(200..300).contains(&rm_status) {
            return Err(WordpressError(format!(
                "Rank Math accepteert de wijziging niet ({rm_status}). {}",
                short_body(&rm_body)
            )));
        }

        let stored = self.get_seo(post_type, id).await?;
        if same(&stored.title, title) && same(&stored.description, description) {
            Ok(stored)
        } else {
            Err(WordpressError(
                "WordPress meldt succes, maar de Rank Math-velden zijn daarna niet gevuld. \
                 Controleer of Rank Math actief is en of de gebruiker deze pagina mag bewerken."
                    .into(),
            ))
        }
    }

    async fn send(
        &self,
        request: reqwest::RequestBuilder,
        label: &str,
    ) -> Result<(u16, serde_json::Value), WordpressError> {
        let resp = request.send().await?;
        let status = resp.status().as_u16();
        let text = resp.text().await.unwrap_or_default();
        if status == 401 || status == 403 {
            return Ok((status, serde_json::Value::String(text)));
        }
        if !(200..300).contains(&status) {
            return Err(WordpressError(format!(
                "{label} mislukt ({status}): {}",
                short_body(&serde_json::Value::String(text))
            )));
        }
        let parsed: serde_json::Value = serde_json::from_str(&text)?;
        Ok((status, parsed))
    }
}

fn normalize_base(base: &str) -> String {
    let trimmed = base.trim().trim_end_matches('/');
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    }
}

/// Pad van een volledige URL, zonder host en zonder query.
fn path_from_url(url: &str) -> String {
    let without_query = url.split(['?', '#']).next().unwrap_or(url);
    let rest = match without_query.split_once("://") {
        Some((_, rest)) => rest,
        None => without_query,
    };
    let mut segments = rest.split('/').filter(|s| !s.is_empty());
    let first = segments.next().unwrap_or("");
    // Zonder scheme kan de URL met de host beginnen ("white-vision.nl/blog/...").
    let path: Vec<&str> = if first.contains('.') {
        segments.collect()
    } else {
        let mut parts = vec![first];
        parts.extend(segments);
        parts
    };
    format!("/{}", path.join("/"))
}

/// Minimale percent-encoding voor de slug in een query string.
fn encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn text(value: Option<&serde_json::Value>) -> String {
    match value {
        Some(serde_json::Value::String(s)) => s.clone(),
        Some(serde_json::Value::Object(map)) => map
            .get("raw")
            .or_else(|| map.get("rendered"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        _ => String::new(),
    }
}

fn rendered(value: Option<&serde_json::Value>) -> String {
    text(value)
}

fn seo_from_json(body: &serde_json::Value, post_type: &str, id: u64) -> WpSeo {
    let meta = body.get("meta");
    let field = |key: &str| {
        meta.and_then(|m| m.get(key))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string()
    };
    let title = {
        let from_meta = field("rank_math_title");
        if from_meta.is_empty() {
            text(body.get("title"))
        } else {
            from_meta
        }
    };
    WpSeo {
        id,
        post_type: post_type.to_string(),
        permalink: body
            .get("link")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        title,
        description: field("rank_math_description"),
        focus_keyword: field("rank_math_focus_keyword"),
    }
}

fn same(a: &str, b: &str) -> bool {
    a.trim() == b.trim()
}

fn short_body(body: &serde_json::Value) -> String {
    let raw = match body {
        serde_json::Value::String(s) => s.clone(),
        other => other.to_string(),
    };
    let collapsed = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() > 300 {
        let short: String = collapsed.chars().take(300).collect();
        format!("{short}…")
    } else {
        collapsed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pad_uit_url() {
        assert_eq!(path_from_url("https://white-vision.nl/regelaars/"), "/regelaars");
        assert_eq!(
            path_from_url("https://white-vision.nl/blog/wetsuit-keuze?utm=1"),
            "/blog/wetsuit-keuze"
        );
        assert_eq!(path_from_url("white-vision.nl"), "/");
    }

    #[test]
    fn basisurl_normaliseren() {
        assert_eq!(normalize_base("white-vision.nl/"), "https://white-vision.nl");
        assert_eq!(
            normalize_base(" http://staging.white-vision.nl "),
            "http://staging.white-vision.nl"
        );
    }

    #[test]
    fn seo_velden_uit_rest_reactie() {
        let body = serde_json::json!({
            "id": 42,
            "link": "https://white-vision.nl/regelaars/",
            "title": { "raw": "Regelaars" },
            "meta": {
                "rank_math_title": "Duikregelaars kopen | White Vision",
                "rank_math_description": "Bekijk onze duikregelaars.",
                "rank_math_focus_keyword": "duikregelaars"
            }
        });
        let seo = seo_from_json(&body, "pages", 42);
        assert_eq!(seo.title, "Duikregelaars kopen | White Vision");
        assert_eq!(seo.focus_keyword, "duikregelaars");
        assert_eq!(seo.permalink, "https://white-vision.nl/regelaars/");
    }

    #[test]
    fn valt_terug_op_paginatitel_zonder_rank_math() {
        let body = serde_json::json!({
            "id": 7,
            "title": { "raw": "Over ons" },
            "meta": {}
        });
        let seo = seo_from_json(&body, "pages", 7);
        assert_eq!(seo.title, "Over ons");
        assert!(seo.description.is_empty());
    }
}
