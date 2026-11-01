//! Inloggen op de analytics-service met DCR + PKCE en een loopback-callback.
//!
//! De service is zijn eigen authorization-server: Adlytica registreert zich daar
//! dynamisch (`POST /register`), stuurt de gebruiker naar `/authorize` (dat op zijn
//! beurt naar Google gaat) en wisselt de code op een lokale poort in voor een
//! bearer-token. Er is dus geen client-secret in de app en geen SSH-tunnel nodig.

use base64::Engine;
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::{Duration, Instant};

/// Alles wat de app nodig heeft om de service te bevragen.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Credentials {
    #[serde(default)]
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub client_id: Option<String>,
}

impl Credentials {
    pub fn is_empty(&self) -> bool {
        self.access_token.trim().is_empty()
    }
}

#[derive(Debug, Deserialize)]
struct Metadata {
    authorization_endpoint: String,
    token_endpoint: String,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
}

fn random_string(len: usize) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    let mut rng = rand::thread_rng();
    (0..len)
        .map(|_| CHARS[rng.gen_range(0..CHARS.len())] as char)
        .collect()
}

/// PKCE: S256-challenge van de verifier, base64url zonder padding.
fn challenge_for(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest)
}

/// HTTP-client met expliciete time-outs. Zonder time-out blijft een hangende
/// verbinding eeuwig wachten: dan opent er geen browser en verschijnt er ook geen
/// foutmelding, wat precies op een bevroren login lijkt.
fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .build()
        .unwrap_or_default()
}

/// Logt een stap naar stderr én naar `<configmap>/login.log`, zodat een mislukte
/// login op een andere machine te achterhalen is. Groeit nooit onbeperkt: boven
/// 256 KB wordt de log gerouleerd naar `login.log.old` en opnieuw begonnen.
pub(crate) fn log_step(message: &str) {
    eprintln!("[login] {message}");
    let Some(dir) = crate::config::config_dir() else {
        return;
    };
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("login.log");
    // Rotatie: append-first kan niet teruglezen, dus via metadata checken
    // vóór het openen. Mislukt het renamen, dan gewoon doorschrijven —
    // logging mag een login nooit tegenhouden.
    if std::fs::metadata(&path).map(|m| m.len() >= 256 * 1024).unwrap_or(false) {
        let old = dir.join("login.log.old");
        let _ = std::fs::remove_file(&old);
        let _ = std::fs::rename(&path, &old);
    }
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let _ = writeln!(file, "{stamp} {message}");
    }
}

fn encode_query(pairs: &[(&str, &str)]) -> String {
    let mut serializer = url::form_urlencoded::Serializer::new(String::new());
    for (k, v) in pairs {
        serializer.append_pair(k, v);
    }
    serializer.finish()
}

pub fn open_browser(url: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        // Zonder cmd: `cmd /C start` verprutst de '&' in de authorize-URL en
        // explorer.exe opent bij zulke URL de Documenten-map. Bewezen werkend
        // op deze machine: rundll32 url.dll,FileProtocolHandler <url> — belt
        // ShellExecute met de volledige URL, zonder tussenkomst van cmd.
        return std::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", url])
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("kon de browser niet openen: {e}"));
    }

    #[cfg(target_os = "macos")]
    let program = "open";
    #[cfg(all(unix, not(target_os = "macos")))]
    let program = "xdg-open";

    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new(program)
            .arg(url)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("kon de browser niet openen: {e}"))
    }
}

async fn fetch_metadata(base: &str) -> Result<Metadata, String> {
    let url = format!("{base}/.well-known/oauth-authorization-server");
    log_step(&format!("metadata ophalen van {url}"));
    let resp = http_client()
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("geen verbinding met {url}: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("{url} gaf HTTP {}", resp.status().as_u16()));
    }
    resp.json::<Metadata>()
        .await
        .map_err(|e| format!("onverwachte metadata van {url}: {e}"))
}

async fn register_client(base: &str, redirect_uri: &str) -> Result<String, String> {
    let body = serde_json::json!({
        "client_name": "Adlytica",
        "redirect_uris": [redirect_uri],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
    });
    log_step(&format!("client registreren bij {base}/register (redirect {redirect_uri})"));
    let resp = http_client()
        .post(format!("{base}/register"))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("registratie bij de service mislukte: {e}"))?;
    let status = resp.status().as_u16();
    let text = resp.text().await.unwrap_or_default();
    if !(200..300).contains(&status) {
        return Err(format!("registratie gaf HTTP {status}: {text}"));
    }
    serde_json::from_str::<serde_json::Value>(&text)
        .ok()
        .and_then(|v| v.get("client_id").and_then(|c| c.as_str()).map(str::to_string))
        .ok_or_else(|| "geen client_id in het registratieantwoord".to_string())
}

/// Wacht op de redirect op de lokale poort en haalt `code` en `state` eruit.
fn wait_for_callback(listener: TcpListener, timeout: Duration) -> Result<(String, String), String> {
    let _ = listener.set_nonblocking(true);
    let deadline = Instant::now() + timeout;

    loop {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let mut buf = [0u8; 4096];
                let read = stream.read(&mut buf).unwrap_or(0);
                let request = String::from_utf8_lossy(&buf[..read]).to_string();
                let target = request
                    .lines()
                    .next()
                    .and_then(|line| line.split_whitespace().nth(1))
                    .unwrap_or("")
                    .to_string();
                let query = target.splitn(2, '?').nth(1).unwrap_or("");

                let mut code = String::new();
                let mut state = String::new();
                let mut error = String::new();
                for (key, value) in url::form_urlencoded::parse(query.as_bytes()) {
                    match key.as_ref() {
                        "code" => code = value.into_owned(),
                        "state" => state = value.into_owned(),
                        "error" => error = value.into_owned(),
                        _ => {}
                    }
                }

                let (headline, detail) = if error.is_empty() {
                    ("Gelukt", "Je kunt dit tabblad sluiten en teruggaan naar Adlytica.")
                } else {
                    ("Inloggen mislukt", "Ga terug naar Adlytica voor de melding.")
                };
                let body = format!(
                    "<!doctype html><html lang=\"nl\"><meta charset=\"utf-8\"><title>{headline}</title>\
                     <body style=\"font-family:system-ui;padding:40px\"><h2>{headline}</h2><p>{detail}</p></body></html>"
                );
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.write_all(response.as_bytes());
                let _ = stream.flush();

                if !error.is_empty() {
                    return Err(format!("de service gaf een fout terug: {error}"));
                }
                if code.is_empty() {
                    return Err("geen code ontvangen op de callback".into());
                }
                return Ok((code, state));
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                if Instant::now() > deadline {
                    return Err("time-out: geen login ontvangen — probeer het opnieuw".into());
                }
                std::thread::sleep(Duration::from_millis(120));
            }
            Err(e) => return Err(format!("callback-serverfout: {e}")),
        }
    }
}

async fn post_form(url: &str, pairs: &[(&str, &str)]) -> Result<TokenResponse, String> {
    log_step(&format!("token uitwisselen bij {url}"));
    let resp = http_client()
        .post(url)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(encode_query(pairs))
        .send()
        .await
        .map_err(|e| format!("token-aanvraag mislukte: {e}"))?;
    let status = resp.status().as_u16();
    let text = resp.text().await.unwrap_or_default();
    if !(200..300).contains(&status) {
        return Err(format!("token-aanvraag gaf HTTP {status}: {text}"));
    }
    serde_json::from_str(&text).map_err(|e| format!("onverwacht token-antwoord: {e} — {text}"))
}

/// Een gestarte login: de listener staat open en de code kan worden ingewisseld.
pub struct PendingLogin {
    token_endpoint: String,
    client_id: String,
    redirect_uri: String,
    verifier: String,
    state: String,
    listener: TcpListener,
}

/// Registreert de app, zet de callback-listener klaar en geeft de authorize-URL
/// terug. De URL is een gewone returnwaarde (geen event), zodat de UI hem altijd
/// kan tonen — ook als de browser niet opent.
pub async fn prepare(base_url: &str) -> Result<(String, PendingLogin), String> {
    let base = base_url.trim().trim_end_matches('/').to_string();
    if base.is_empty() {
        return Err("Vul eerst de service-URL in bij Instellingen.".into());
    }

    log_step(&format!("login gestart tegen {base}"));
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("kon geen lokale callback-poort openen: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("kon de callback-poort niet lezen: {e}"))?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}/oauth/callback");

    let metadata = fetch_metadata(&base).await?;
    let client_id = register_client(&base, &redirect_uri).await?;

    let state = random_string(32);
    let verifier = random_string(64);
    let challenge = challenge_for(&verifier);

    let auth_url = format!(
        "{}?{}",
        metadata.authorization_endpoint,
        encode_query(&[
            ("response_type", "code"),
            ("client_id", &client_id),
            ("redirect_uri", &redirect_uri),
            ("state", &state),
            ("code_challenge", &challenge),
            ("code_challenge_method", "S256"),
        ])
    );
    log_step(&format!("authorize-URL klaar ({redirect_uri})"));

    Ok((
        auth_url,
        PendingLogin {
            token_endpoint: metadata.token_endpoint,
            client_id,
            redirect_uri,
            verifier,
            state,
            listener,
        },
    ))
}

/// Wacht op de callback en wisselt de code in voor een token. Dit blokkeert tot de
/// gebruiker inlogt of de time-out verstrijkt, dus hoort in een achtergrondtaak.
pub async fn finish(pending: PendingLogin, timeout: Duration) -> Result<Credentials, String> {
    let PendingLogin {
        token_endpoint,
        client_id,
        redirect_uri,
        verifier,
        state,
        listener,
    } = pending;

    let wait_result = tokio::task::spawn_blocking(move || wait_for_callback(listener, timeout))
        .await
        .map_err(|e| format!("callback-taak mislukte: {e}"))?;
    let (code, returned_state) = wait_result?;
    if returned_state != state {
        return Err("de callback hoorde niet bij deze loginpoging (state verschilt)".into());
    }

    log_step("callback ontvangen; code inwisselen");
    let token = post_form(
        &token_endpoint,
        &[
            ("grant_type", "authorization_code"),
            ("code", &code),
            ("redirect_uri", &redirect_uri),
            ("client_id", &client_id),
            ("code_verifier", &verifier),
        ],
    )
    .await?;
    log_step("token ontvangen");

    Ok(Credentials {
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        client_id: Some(client_id),
    })
}

/// Ververst een verlopen access-token; dat voorkomt opnieuw inloggen.
pub async fn refresh(base_url: &str, refresh_token: &str, client_id: Option<&str>) -> Result<Credentials, String> {
    let base = base_url.trim().trim_end_matches('/');
    let metadata = fetch_metadata(base).await?;
    let token = post_form(
        &metadata.token_endpoint,
        &[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("client_id", client_id.unwrap_or("")),
        ],
    )
    .await?;

    Ok(Credentials {
        access_token: token.access_token,
        refresh_token: token.refresh_token.or_else(|| Some(refresh_token.to_string())),
        client_id: client_id.map(str::to_string),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_challenge_is_base64url_zonder_padding() {
        // RFC 7636 voorbeeld: de challenge is de S256-hash, base64url, zonder '='.
        let challenge = challenge_for("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
        assert_eq!(challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
        assert!(!challenge.contains('='));
    }

    #[test]
    fn random_strings_zijn_uniek_en_van_de_juiste_lengte() {
        let a = random_string(64);
        let b = random_string(64);
        assert_eq!(a.len(), 64);
        assert_ne!(a, b);
        assert!(a.chars().all(|c| c.is_ascii_alphanumeric() || "-._~".contains(c)));
    }

    #[test]
    fn query_encoding_escaped_wat_google_verwacht() {
        let query = encode_query(&[("redirect_uri", "http://127.0.0.1:8765/oauth/callback"), ("state", "a b")]);
        assert!(query.contains("redirect_uri=http%3A%2F%2F127.0.0.1%3A8765%2Foauth%2Fcallback"));
        assert!(query.contains("state=a+b"));
    }

    #[test]
    fn lege_credentials_zijn_herkenbaar() {
        assert!(Credentials::default().is_empty());
        assert!(!Credentials {
            access_token: "x".into(),
            ..Default::default()
        }
        .is_empty());
    }
}
