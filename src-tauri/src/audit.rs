//! Technische SEO-audit: crawlt de eigen site en controleert per pagina de
//! dingen die er in de praktijk toe doen. Naast losse bevindingen levert de
//! crawl een health score, gegroepeerde taken, een interne-linkgrafiek en een
//! geschiedenis op, zodat je vooruitgang kunt zien.

use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};
use url::Url;

const USER_AGENT: &str = "Adlytica/0.1 (technische SEO-audit)";
const CONCURRENCY: usize = 6;
const MAX_LINK_CHECKS: usize = 150;
const KEEP_RUNS: usize = 20;
/// Hoeveel pagina's per AI-crawler worden opgevraagd. Klein houden: elke bot
/// kost één request per pagina en de steekproef moet de audit niet vertragen.
const AI_SAMPLE_PAGES: usize = 6;
const MAX_EXAMPLES: usize = 3;
const SOFT_404_PROBES: usize = 2;
/// Een patroon geldt pas als trap vanaf dit aantal treffers in de crawl.
const TRAP_MIN_HITS: usize = 3;

#[derive(Serialize, Clone)]
pub struct AuditIssue {
    pub code: String,
    pub severity: String,
    pub message: String,
}

#[derive(Serialize)]
pub struct AuditPage {
    pub url: String,
    pub status: u16,
    pub final_url: String,
    pub redirect: bool,
    pub title: String,
    pub title_len: usize,
    pub meta_len: usize,
    pub h1: String,
    pub h1_count: usize,
    pub canonical: String,
    pub noindex: bool,
    pub words: usize,
    pub images: usize,
    pub images_no_alt: usize,
    pub internal_links: usize,
    pub external_links: usize,
    pub schema: Vec<String>,
    pub og: bool,
    pub hreflang: usize,
    pub lang_missing: bool,
    pub inbound: usize,
    pub score: u8,
    pub similar: Vec<String>,
    pub ms: u64,
    pub errors: usize,
    pub warnings: usize,
    pub issues: Vec<AuditIssue>,
    /// Alleen intern gebruikt voor de vergelijking op inhoud.
    #[serde(skip)]
    pub shingles: Vec<u64>,
}

#[derive(Serialize)]
pub struct LinkFinding {
    pub source: String,
    pub target: String,
    pub kind: String,
    pub status: u16,
    pub problem: String,
}

#[derive(Serialize)]
pub struct Task {
    pub code: String,
    pub label: String,
    pub severity: String,
    pub impact: String,
    pub count: usize,
    pub pages: Vec<String>,
}

#[derive(Serialize)]
pub struct SiteCheck {
    pub label: String,
    pub ok: bool,
    pub detail: String,
}

/// Wat één AI-crawler te zien krijgt als hij de steekproefpagina's ophaalt.
#[derive(Serialize)]
pub struct AiCrawlerResult {
    pub bot: String,
    pub robots_blocked: bool,
    pub sampled: usize,
    pub blocked: usize,
    pub challenged: usize,
    pub different_title: usize,
    pub thinner: usize,
    pub js_only: usize,
    pub notes: Vec<String>,
}

impl AiCrawlerResult {
    fn has_problems(&self) -> bool {
        self.robots_blocked
            || self.blocked > 0
            || self.challenged > 0
            || self.different_title > 0
            || self.thinner > 0
            || self.js_only > 0
    }

    fn summary(&self) -> String {
        if self.robots_blocked {
            return format!("{} is geblokkeerd in robots.txt.", self.bot);
        }
        if self.blocked > 0 {
            return format!("{} kreeg {} van {} pagina's niet binnen.", self.bot, self.blocked, self.sampled);
        }
        if self.challenged > 0 {
            return format!("{} stuitte op een CDN-challenge ({} van {}).", self.bot, self.challenged, self.sampled);
        }
        if self.js_only > 0 || self.thinner > 0 {
            return format!("{} krijgt minder inhoud dan een gewone bezoeker.", self.bot);
        }
        if self.different_title > 0 {
            return format!("{} ziet een andere titel dan een gewone bezoeker.", self.bot);
        }
        format!("{} ziet dezelfde pagina's.", self.bot)
    }
}

/// Vergelijking tussen de sitemap en wat de crawl daadwerkelijk tegenkwam.
#[derive(Serialize)]
pub struct SitemapReport {
    pub found: bool,
    pub urls: usize,
    pub not_found: Vec<String>,
    pub redirected: Vec<String>,
    pub missing_from_crawl: Vec<String>,
    pub missing_from_crawl_total: usize,
    pub not_in_sitemap: Vec<String>,
}

#[derive(Serialize)]
pub struct CrawlTrap {
    pub pattern: String,
    pub label: String,
    pub robots: String,
    pub count: usize,
    pub examples: Vec<String>,
}

/// Hoeveel van de crawl uit parametervarianten bestaat en welke patronen zich
/// als URL-trap gedragen.
#[derive(Serialize)]
pub struct CrawlBudget {
    pub total: usize,
    pub with_params: usize,
    pub param_share_pct: f64,
    pub traps: Vec<CrawlTrap>,
    pub soft_404: Vec<String>,
    pub advice: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct PreviousRun {
    pub at: String,
    pub score: u8,
    pub errors: usize,
    pub warnings: usize,
    pub crawled: usize,
}

#[derive(Serialize)]
pub struct AuditResult {
    pub base: String,
    pub pages: Vec<AuditPage>,
    pub crawled: usize,
    pub failed: usize,
    pub truncated: bool,
    pub sitemap_urls: usize,
    pub duration_ms: u64,
    pub score: u8,
    pub tasks: Vec<Task>,
    pub links: Vec<LinkFinding>,
    pub orphans: Vec<String>,
    pub checks: Vec<SiteCheck>,
    pub ai_crawlers: Vec<AiCrawlerResult>,
    pub sitemap: SitemapReport,
    pub crawl_budget: CrawlBudget,
    pub previous: Option<PreviousRun>,
}

struct Fetched {
    status: u16,
    final_url: String,
    body: String,
    content_type: String,
    ms: u64,
}

#[derive(Serialize, Deserialize, Clone)]
struct PageSnapshot {
    url: String,
    status: u16,
    score: u8,
    errors: usize,
    warnings: usize,
}

#[derive(Serialize, Deserialize, Clone)]
struct Snapshot {
    at: String,
    base: String,
    score: u8,
    errors: usize,
    warnings: usize,
    crawled: usize,
    pages: Vec<PageSnapshot>,
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(25))
        .redirect(reqwest::redirect::Policy::limited(8))
        .build()
        .unwrap_or_default()
}

async fn get(client: &reqwest::Client, url: &str) -> Result<Fetched, String> {
    let started = Instant::now();
    let response = client.get(url).send().await.map_err(|e| e.to_string())?;
    let status = response.status().as_u16();
    let final_url = response.url().to_string();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let body = response.text().await.unwrap_or_default();
    Ok(Fetched { status, final_url, body, content_type, ms: started.elapsed().as_millis() as u64 })
}

fn issue(code: &str, severity: &str, message: String) -> AuditIssue {
    AuditIssue { code: code.to_string(), severity: severity.to_string(), message }
}

fn selector(query: &str) -> Selector {
    Selector::parse(query).expect("geldige selector")
}

fn clean(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Eén URL-vorm voor vergelijkingen: zonder fragment en zonder slot-schuin.
fn normalize(value: &str) -> String {
    let trimmed = value.split('#').next().unwrap_or(value);
    let without_slash = trimmed.trim_end_matches('/');
    if without_slash.is_empty() {
        trimmed.to_string()
    } else {
        without_slash.to_string()
    }
}

/// Trekt de URL's uit een sitemap (ook uit een sitemapindex).
async fn sitemap_urls(client: &reqwest::Client, base: &Url, cap: usize) -> Vec<String> {
    let mut roots = vec![
        base.join("/sitemap.xml").ok(),
        base.join("/sitemap_index.xml").ok(),
        base.join("/wp-sitemap.xml").ok(),
    ];
    if let Ok(robots) = get(client, &base.join("/robots.txt").unwrap_or_else(|_| base.clone()).to_string()).await {
        for line in robots.body.lines() {
            if let Some(rest) = line.trim().strip_prefix("Sitemap:") {
                if let Ok(found) = Url::parse(rest.trim()) {
                    roots.push(Some(found));
                }
            }
        }
    }

    let mut urls: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for root in roots.into_iter().flatten() {
        if urls.len() >= cap {
            break;
        }
        let Ok(fetched) = get(client, root.as_str()).await else { continue };
        if fetched.status != 200 || !fetched.body.contains("<loc>") {
            continue;
        }
        let locs = extract_locs(&fetched.body);
        if fetched.body.contains("<sitemapindex") {
            for child in locs.into_iter().take(5) {
                if urls.len() >= cap {
                    break;
                }
                if let Ok(child_page) = get(client, &child).await {
                    for loc in extract_locs(&child_page.body) {
                        if urls.len() >= cap {
                            break;
                        }
                        if seen.insert(loc.clone()) {
                            urls.push(loc);
                        }
                    }
                }
            }
        } else {
            for loc in locs {
                if urls.len() >= cap {
                    break;
                }
                if seen.insert(loc.clone()) {
                    urls.push(loc);
                }
            }
        }
    }
    urls
}

fn extract_locs(xml: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = xml;
    while let Some(start) = rest.find("<loc>") {
        let after = &rest[start + 5..];
        let Some(end) = after.find("</loc>") else { break };
        let value = after[..end].trim().replace("&amp;", "&");
        if value.starts_with("http") {
            out.push(value);
        }
        rest = &after[end..];
    }
    out
}

/// De user-agents waarmee AI-crawlers langskomen. Googlebot zit erbij als
/// ijkpunt: ziet die hetzelfde als de AI-bots, dan is er niets aan de hand.
struct AiBot {
    name: &'static str,
    agent: &'static str,
}

const AI_BOTS: [AiBot; 5] = [
    AiBot {
        name: "Googlebot",
        agent: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    },
    AiBot {
        name: "GPTBot",
        agent: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot",
    },
    AiBot {
        name: "OAI-SearchBot",
        agent: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot",
    },
    AiBot {
        name: "PerplexityBot",
        agent: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot",
    },
    AiBot {
        name: "CCBot",
        agent: "CCBot/2.0 (https://commoncrawl.org/faq/)",
    },
];

/// Patronen die in de praktijk crawl-budget opeten. Het derde veld is meteen
/// de regel die je in robots.txt kunt zetten.
const TRAP_PATTERNS: [(&str, &str, &str); 8] = [
    ("?e-page-", "Elementor-paginering", "Disallow: /*?e-page-"),
    ("?replytocom=", "Reacties", "Disallow: /*?replytocom="),
    ("?s=", "Zoekresultaten", "Disallow: /*?s="),
    ("?preview=", "Voorbeeldweergave", "Disallow: /*?preview="),
    ("?orderby=", "Sortering", "Disallow: /*?orderby="),
    ("?filter_", "WooCommerce-filters", "Disallow: /*?filter_"),
    ("?add-to-cart=", "Winkelwagen", "Disallow: /*?add-to-cart="),
    ("?p=", "WordPress-ID's", "Disallow: /*?p="),
];

fn path_of(url: &str) -> String {
    Url::parse(url)
        .map(|parsed| {
            let mut path = parsed.path().to_string();
            if let Some(query) = parsed.query() {
                path.push('?');
                path.push_str(query);
            }
            path
        })
        .unwrap_or_else(|_| url.to_string())
}

fn shorten(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    text.chars().take(max.saturating_sub(1)).collect::<String>() + "…"
}

fn epoch_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or(0)
}

/// Leest robots.txt en zegt of deze bot volledig buiten de deur wordt gehouden.
/// Alleen een `Disallow: /` in een groep die voor deze bot geldt telt: losse
/// uitsluitingen zoals `/wp-admin` blokkeren de site niet.
fn robots_blocks(body: &str, bot: &str) -> bool {
    let bot = bot.to_lowercase();
    let mut applies = false;
    let mut blocked = false;
    for raw in body.lines() {
        let line = raw.split('#').next().unwrap_or("").trim().to_lowercase();
        if line.is_empty() {
            continue;
        }
        if let Some(rest) = line.strip_prefix("user-agent:") {
            let agent = rest.trim();
            applies = agent == "*" || agent == bot || (!agent.is_empty() && bot.contains(agent));
            continue;
        }
        if !applies {
            continue;
        }
        if let Some(rest) = line.strip_prefix("disallow:") {
            let value = rest.trim();
            if value == "/" || value == "/*" {
                blocked = true;
            }
        }
    }
    blocked
}

/// Vraagt de steekproefpagina's op als Googlebot en als de AI-crawlers, en
/// vergelijkt wat zij krijgen met wat een gewone bezoeker kreeg.
async fn check_ai_crawlers(pages: &[AuditPage], home: &str, robots: &str) -> Vec<AiCrawlerResult> {
    let mut sample: Vec<String> = Vec::new();
    if let Some(page) = pages.iter().find(|p| normalize(&p.url) == normalize(home)) {
        sample.push(page.url.clone());
    }
    let mut ranked: Vec<&AuditPage> = pages
        .iter()
        .filter(|p| p.status == 200 && !p.redirect)
        .collect();
    ranked.sort_by(|a, b| b.inbound.cmp(&a.inbound).then(b.words.cmp(&a.words)));
    for page in ranked {
        if sample.len() >= AI_SAMPLE_PAGES {
            break;
        }
        if sample.iter().any(|url| normalize(url) == normalize(&page.url)) {
            continue;
        }
        sample.push(page.url.clone());
    }

    let mut results: Vec<AiCrawlerResult> = Vec::new();
    for bot in AI_BOTS.iter() {
        let client = reqwest::Client::builder()
            .user_agent(bot.agent)
            .timeout(Duration::from_secs(20))
            .redirect(reqwest::redirect::Policy::limited(8))
            .build()
            .unwrap_or_default();
        let mut blocked = 0usize;
        let mut challenged = 0usize;
        let mut different_title = 0usize;
        let mut thinner = 0usize;
        let mut js_only = 0usize;
        let mut notes: Vec<String> = Vec::new();

        for url in &sample {
            let baseline = pages.iter().find(|p| normalize(&p.url) == normalize(url));
            let fetched = match get(&client, url).await {
                Ok(fetched) => fetched,
                Err(error) => {
                    blocked += 1;
                    if notes.len() < MAX_EXAMPLES {
                        notes.push(format!("{} mislukte op {}: {}", bot.name, path_of(url), shorten(&error, 80)));
                    }
                    continue;
                }
            };
            if fetched.status >= 400 {
                blocked += 1;
                if notes.len() < MAX_EXAMPLES {
                    notes.push(format!("{} kreeg status {} op {}", bot.name, fetched.status, path_of(url)));
                }
                continue;
            }
            let lower = fetched.body.to_lowercase();
            let challenge = lower.contains("just a moment")
                || lower.contains("cf-challenge")
                || lower.contains("attention required")
                || lower.contains("enable javascript and cookies to continue");
            if challenge {
                challenged += 1;
                if notes.len() < MAX_EXAMPLES {
                    notes.push(format!("CDN-challenge op {}", path_of(url)));
                }
                continue;
            }

            let document = Html::parse_document(&fetched.body);
            let title = document
                .select(&selector("title"))
                .next()
                .map(|element| clean(&element.text().collect::<String>()))
                .unwrap_or_default();
            let words = content_text(&document).split_whitespace().count();

            let Some(reference) = baseline else { continue };
            if !reference.title.is_empty()
                && !title.is_empty()
                && normalize(&title.to_lowercase()) != normalize(&reference.title.to_lowercase())
            {
                different_title += 1;
                if notes.len() < MAX_EXAMPLES {
                    notes.push(format!("andere title op {}: \"{}\"", path_of(url), shorten(&title, 60)));
                }
            }
            if reference.words > 100 && words * 100 < reference.words * 60 {
                thinner += 1;
                if notes.len() < MAX_EXAMPLES {
                    notes.push(format!(
                        "dunnere pagina op {}: {} woorden in plaats van {}",
                        path_of(url),
                        words,
                        reference.words
                    ));
                }
            }
            if reference.words > 150 && words < 40 {
                js_only += 1;
            }
        }

        results.push(AiCrawlerResult {
            bot: bot.name.to_string(),
            robots_blocked: robots_blocks(robots, bot.name),
            sampled: sample.len(),
            blocked,
            challenged,
            different_title,
            thinner,
            js_only,
            notes,
        });
    }
    results
}

/// Vergelijkt de sitemap met wat de crawl heeft opgehaald.
fn build_sitemap_report(sitemap: &[String], pages: &[AuditPage]) -> SitemapReport {
    let sitemap_set: HashSet<String> = sitemap.iter().map(|url| normalize(url)).collect();
    let crawled: HashSet<String> = pages.iter().map(|page| normalize(&page.url)).collect();

    let mut not_found: Vec<String> = Vec::new();
    let mut redirected: Vec<String> = Vec::new();
    for page in pages {
        if !sitemap_set.contains(&normalize(&page.url)) {
            continue;
        }
        if page.status >= 400 {
            not_found.push(format!("{} ({})", page.url, page.status));
        } else if page.redirect {
            redirected.push(format!("{} → {}", page.url, page.final_url));
        }
    }

    let mut missing_from_crawl: Vec<String> = sitemap
        .iter()
        .filter(|url| !crawled.contains(&normalize(url)))
        .cloned()
        .collect();
    missing_from_crawl.sort();
    let missing_from_crawl_total = missing_from_crawl.len();
    missing_from_crawl.truncate(50);

    let mut not_in_sitemap: Vec<String> = pages
        .iter()
        .filter(|page| !sitemap_set.contains(&normalize(&page.url)))
        .map(|page| page.url.clone())
        .collect();
    not_in_sitemap.sort();
    not_in_sitemap.truncate(50);

    SitemapReport {
        found: !sitemap.is_empty(),
        urls: sitemap.len(),
        not_found,
        redirected,
        missing_from_crawl,
        missing_from_crawl_total,
        not_in_sitemap,
    }
}

/// Telt parametervarianten en herkent bekende URL-traps.
fn build_crawl_budget(urls: &[String], soft_404: Vec<String>) -> CrawlBudget {
    let total = urls.len();
    let with_params = urls
        .iter()
        .filter(|url| Url::parse(url).map(|parsed| parsed.query().is_some()).unwrap_or(false))
        .count();
    let param_share_pct = if total == 0 {
        0.0
    } else {
        (with_params as f64) * 100.0 / (total as f64)
    };

    let mut traps: Vec<CrawlTrap> = Vec::new();
    for (pattern, label, robots) in TRAP_PATTERNS {
        let hits: Vec<&String> = urls
            .iter()
            .filter(|url| url.to_lowercase().contains(pattern))
            .collect();
        if hits.len() < TRAP_MIN_HITS {
            continue;
        }
        let examples: Vec<String> = hits.iter().take(MAX_EXAMPLES).map(|url| path_of(url)).collect();
        traps.push(CrawlTrap {
            pattern: pattern.to_string(),
            label: label.to_string(),
            robots: robots.to_string(),
            count: hits.len(),
            examples,
        });
    }
    traps.sort_by(|a, b| b.count.cmp(&a.count));

    let mut advice: Vec<String> = traps.iter().map(|trap| trap.robots.clone()).collect();
    if param_share_pct >= 20.0 {
        advice.push("# Meer dan 20% van de gevonden URL's is een parametervariant.".to_string());
    }

    CrawlBudget {
        total,
        with_params,
        param_share_pct: (param_share_pct * 10.0).round() / 10.0,
        traps,
        soft_404,
        advice,
    }
}

/// Vraagt twee verzonnen paden op. Krijg je daar 200 op terug, dan bestaat er
/// geen echte 404 en crawlt Google eindeloos door op alles wat op een pagina lijkt.
async fn soft_404_probes(client: &reqwest::Client, base: &Url) -> Vec<String> {
    let mut found: Vec<String> = Vec::new();
    for index in 0..SOFT_404_PROBES {
        let path = format!("/adlytica-bestaat-niet-{}-{}", index + 1, epoch_secs());
        let Ok(url) = base.join(&path) else { continue };
        if let Ok(fetched) = get(client, url.as_str()).await {
            if fetched.status == 200 && fetched.content_type.contains("html") {
                found.push(format!("{} geeft status 200", path));
            }
        }
    }
    found
}

fn is_crawlable(url: &Url) -> bool {
    let scheme_ok = matches!(url.scheme(), "http" | "https");
    if !scheme_ok {
        return false;
    }
    let path = url.path().to_lowercase();
    let blocked = [
        ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".pdf", ".zip", ".xml", ".css", ".js",
        ".ico", ".mp4", ".woff", ".woff2", ".ttf",
    ];
    !blocked.iter().any(|ext| path.ends_with(ext))
}

/// Volgt interne links vanaf de startpagina zolang de sitemap te weinig oplevert.
async fn crawl_links(
    client: &reqwest::Client,
    base: &Url,
    known: &mut Vec<String>,
    seen: &mut HashSet<String>,
    cap: usize,
) {
    let mut queue: Vec<String> = vec![base.to_string()];
    let mut fetched: HashSet<String> = HashSet::new();
    while let Some(url) = queue.pop() {
        if known.len() >= cap || fetched.len() >= cap {
            break;
        }
        if !fetched.insert(url.clone()) {
            continue;
        }
        let Ok(page) = get(client, &url).await else { continue };
        if !page.content_type.contains("html") {
            continue;
        }
        let document = Html::parse_document(&page.body);
        for element in document.select(&selector("a[href]")) {
            let Some(href) = element.value().attr("href") else { continue };
            let Ok(target) = Url::parse(&page.final_url).and_then(|b| b.join(href)) else { continue };
            if target.host_str() != base.host_str() || !is_crawlable(&target) {
                continue;
            }
            let mut normalized = target.clone();
            normalized.set_fragment(None);
            let value = normalized.to_string();
            if seen.insert(value.clone()) {
                known.push(value.clone());
                queue.push(value);
            }
        }
    }
}

/// Tekst waarmee we pagina's op overlap vergelijken: bij voorkeur alleen de
/// hoofdinhoud, zodat navigatie en footer geen vals alarm geven.
fn content_text(document: &Html) -> String {
    for query in ["main p, main h2, main h3", "article p, article h2, article h3", "p, h2, h3"] {
        let handle = selector(query);
        let mut text = String::new();
        for element in document.select(&handle) {
            text.push_str(&element.text().collect::<String>());
            text.push(' ');
        }
        if !text.trim().is_empty() {
            return text;
        }
    }
    String::new()
}

fn shingles_of(text: &str) -> Vec<u64> {
    let words: Vec<&str> = text.split_whitespace().take(260).collect();
    let mut out: Vec<u64> = Vec::new();
    let mut seen: HashSet<u64> = HashSet::new();
    for window in words.windows(5) {
        let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
        for word in window {
            for byte in word.to_lowercase().bytes() {
                hash ^= byte as u64;
                hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
            }
            hash ^= 0x20;
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
        if seen.insert(hash) {
            out.push(hash);
        }
    }
    out
}

fn overlap(left: &[u64], right: &[u64]) -> (f64, usize) {
    if left.is_empty() || right.is_empty() {
        return (0.0, 0);
    }
    let set: HashSet<u64> = right.iter().copied().collect();
    let shared = left.iter().filter(|hash| set.contains(hash)).count();
    let union = left.len() + right.len() - shared;
    if union == 0 {
        (0.0, shared)
    } else {
        (shared as f64 / union as f64, shared)
    }
}

/// Haalt zinnen weg die op bijna elke pagina staan (navigatie, footer, CTA),
/// zodat alleen unieke inhoud overblijft voor de vergelijking.
fn strip_boilerplate(pages: &mut [AuditPage]) {
    if pages.len() < 3 {
        return;
    }
    let mut frequency: HashMap<u64, usize> = HashMap::new();
    for page in pages.iter() {
        for hash in &page.shingles {
            *frequency.entry(*hash).or_insert(0) += 1;
        }
    }
    let threshold = (pages.len() as f64 * 0.6).ceil() as usize;
    let boilerplate: HashSet<u64> = frequency
        .iter()
        .filter(|(_, count)| **count >= threshold.max(2))
        .map(|(hash, _)| *hash)
        .collect();
    for page in pages.iter_mut() {
        page.shingles.retain(|hash| !boilerplate.contains(hash));
    }
}

fn analyse(url: &str, fetched: &Fetched, page_url: &Url) -> (AuditPage, Vec<(String, bool)>) {
    let mut issues: Vec<AuditIssue> = Vec::new();
    let document = Html::parse_document(&fetched.body);

    let title = document
        .select(&selector("title"))
        .next()
        .map(|e| clean(&e.text().collect::<String>()))
        .unwrap_or_default();
    let meta_len = document
        .select(&selector("meta[name=description]"))
        .next()
        .and_then(|e| e.value().attr("content"))
        .map(|v| clean(v).chars().count())
        .unwrap_or(0);
    let h1_texts: Vec<String> = document
        .select(&selector("h1"))
        .map(|e| clean(&e.text().collect::<String>()))
        .filter(|t| !t.is_empty())
        .collect();
    let h1_count = document.select(&selector("h1")).count();
    let h1 = h1_texts.first().cloned().unwrap_or_default();
    let canonical = document
        .select(&selector("link[rel=canonical]"))
        .next()
        .and_then(|e| e.value().attr("href"))
        .map(|v| v.trim().to_string())
        .unwrap_or_default();
    let noindex = document
        .select(&selector("meta[name=robots]"))
        .next()
        .and_then(|e| e.value().attr("content"))
        .map(|v| v.to_lowercase().contains("noindex"))
        .unwrap_or(false);

    let og_title = document.select(&selector("meta[property='og:title']")).next().is_some();
    let og_image = document.select(&selector("meta[property='og:image']")).next().is_some();
    let og = og_title && og_image;
    let hreflang = document.select(&selector("link[rel='alternate'][hreflang]")).count();
    let lang_missing = document
        .select(&selector("html"))
        .next()
        .and_then(|e| e.value().attr("lang"))
        .map(|v| v.trim().is_empty())
        .unwrap_or(true);

    let mut images = 0;
    let mut images_no_alt = 0;
    for image in document.select(&selector("img")) {
        images += 1;
        match image.value().attr("alt") {
            Some(alt) if !alt.trim().is_empty() => {}
            _ => images_no_alt += 1,
        }
    }

    let mut internal_links = 0;
    let mut external_links = 0;
    let mut links: Vec<(String, bool)> = Vec::new();
    let mut linked: HashSet<String> = HashSet::new();
    for anchor in document.select(&selector("a[href]")) {
        let Some(href) = anchor.value().attr("href") else { continue };
        if href.starts_with('#') || href.starts_with("mailto:") || href.starts_with("tel:") {
            continue;
        }
        let Ok(target) = page_url.join(href) else { continue };
        if target.host_str() == page_url.host_str() {
            internal_links += 1;
            let normalized = normalize(target.as_str());
            if linked.insert(normalized.clone()) {
                links.push((normalized, true));
            }
        } else {
            external_links += 1;
            let normalized = normalize(target.as_str());
            if linked.insert(normalized.clone()) {
                links.push((normalized, false));
            }
        }
    }

    let mut schema: Vec<String> = Vec::new();
    for script in document.select(&selector("script[type='application/ld+json']")) {
        let raw = script.text().collect::<String>();
        match serde_json::from_str::<serde_json::Value>(&raw) {
            Ok(value) => {
                let mut collect = |v: &serde_json::Value| {
                    if let Some(kind) = v.get("@type") {
                        match kind {
                            serde_json::Value::String(name) => schema.push(name.clone()),
                            serde_json::Value::Array(names) => {
                                for name in names {
                                    if let Some(text) = name.as_str() {
                                        schema.push(text.to_string());
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                };
                if let Some(items) = value.get("@graph").and_then(|g| g.as_array()) {
                    for item in items {
                        collect(item);
                    }
                } else {
                    collect(&value);
                }
            }
            Err(_) => issues.push(issue(
                "schema_invalid",
                "warning",
                "JSON-LD is geen geldige JSON en wordt genegeerd door Google.".to_string(),
            )),
        }
    }
    schema.sort();
    schema.dedup();

    let body_text = document
        .select(&selector("p, li, h1, h2, h3, h4, h5, h6"))
        .map(|e| e.text().collect::<String>())
        .collect::<Vec<_>>()
        .join(" ");
    let words = body_text.split_whitespace().count();

    if fetched.status >= 400 {
        issues.push(issue("http_error", "error", format!("De pagina geeft status {}.", fetched.status)));
    }
    if fetched.final_url != url && fetched.status < 400 {
        issues.push(issue("redirect", "warning", format!("Pagina eindigt op {}.", fetched.final_url)));
    }
    if title.is_empty() {
        issues.push(issue("title_missing", "error", "Geen title-tag gevonden.".to_string()));
    } else if title.chars().count() < 25 {
        issues.push(issue("title_short", "warning", format!("Title is kort ({} tekens).", title.chars().count())));
    } else if title.chars().count() > 65 {
        issues.push(issue("title_long", "warning", format!("Title is lang ({} tekens, richttijn 60).", title.chars().count())));
    }
    if meta_len == 0 {
        issues.push(issue("meta_missing", "warning", "Geen meta-omschrijving.".to_string()));
    } else if meta_len < 70 {
        issues.push(issue("meta_short", "warning", format!("Meta-omschrijving is kort ({meta_len} tekens).")));
    } else if meta_len > 165 {
        issues.push(issue("meta_long", "warning", format!("Meta-omschrijving is lang ({meta_len} tekens, richttijn 155).")));
    }
    if h1_count == 0 {
        issues.push(issue("h1_missing", "error", "Geen H1 op de pagina.".to_string()));
    } else if h1_count > 1 {
        issues.push(issue("h1_multiple", "warning", format!("{h1_count} H1-koppen op één pagina.")));
    }
    if canonical.is_empty() {
        issues.push(issue("canonical_missing", "warning", "Geen canonical-tag.".to_string()));
    } else if let Ok(target) = page_url.join(&canonical) {
        if target.path() != page_url.path() {
            issues.push(issue("canonical_other", "warning", format!("Canonical wijst naar {}.", target)));
        }
    }
    if noindex {
        issues.push(issue("noindex", "warning", "Pagina staat op noindex.".to_string()));
    }
    if images_no_alt > 0 {
        issues.push(issue(
            "img_alt",
            "warning",
            format!("{images_no_alt} van {images} afbeeldingen zonder alt-tekst."),
        ));
    }
    if words < 300 {
        issues.push(issue("thin_content", "warning", format!("Weinig tekst ({words} woorden).")));
    }
    if fetched.ms > 2000 {
        issues.push(issue("slow", "warning", format!("Reactietijd {} ms.", fetched.ms)));
    }
    if internal_links == 0 && fetched.status < 400 {
        issues.push(issue("no_internal_links", "warning", "Geen interne links op deze pagina.".to_string()));
    }
    if schema.is_empty() {
        issues.push(issue("schema_missing", "warning", "Geen structured data (JSON-LD).".to_string()));
    }
    if !og {
        issues.push(issue("og_missing", "warning", "Geen OpenGraph-tags (og:title of og:image ontbreekt).".to_string()));
    }
    if lang_missing {
        issues.push(issue("lang_missing", "warning", "Geen lang-attribuut op de html-tag.".to_string()));
    }

    let errors = issues.iter().filter(|i| i.severity == "error").count();
    let warnings = issues.iter().filter(|i| i.severity == "warning").count();
    let penalty = (errors * 18 + warnings * 5).min(100);
    let title_len = title.chars().count();

    (
        AuditPage {
            url: url.to_string(),
            status: fetched.status,
            final_url: fetched.final_url.clone(),
            redirect: fetched.final_url != url,
            title,
            title_len,
            meta_len,
            h1,
            h1_count,
            canonical,
            noindex,
            words,
            images,
            images_no_alt,
            internal_links,
            external_links,
            schema,
            og,
            hreflang,
            lang_missing,
            inbound: 0,
            score: (100 - penalty).max(0) as u8,
            similar: Vec::new(),
            ms: fetched.ms,
            errors,
            warnings,
            issues,
            shingles: shingles_of(&content_text(&document)),
        },
        links,
    )
}

/// Vergelijkt pagina's op tekstoverlap (5-woordshingles) en markeert near-duplicates.
fn mark_similar(pages: &mut [AuditPage]) {
    let limit = pages.len().min(250);
    let mut pairs: Vec<(usize, usize, f64)> = Vec::new();
    for left in 0..limit {
        for right in (left + 1)..limit {
            let (value, shared) = overlap(&pages[left].shingles, &pages[right].shingles);
            if value >= 0.6 && shared >= 12 {
                pairs.push((left, right, value));
            }
        }
    }
    pairs.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal));
    for (left, right, value) in pairs.into_iter().take(200) {
        let percent = (value * 100.0_f64).round() as u32;
        let left_url = pages[right].url.clone();
        let right_url = pages[left].url.clone();
        pages[left].similar.push(left_url.clone());
        pages[right].similar.push(right_url.clone());
        pages[left].issues.push(issue(
            "similar_content",
            "warning",
            format!("{percent}% overlap met {left_url}."),
        ));
        pages[right].issues.push(issue(
            "similar_content",
            "warning",
            format!("{percent}% overlap met {right_url}."),
        ));
    }
}

fn mark_duplicates(pages: &mut [AuditPage]) {
    fn groups(pages: &[AuditPage], pick: impl Fn(&AuditPage) -> String) -> HashMap<String, usize> {
        let mut map: HashMap<String, usize> = HashMap::new();
        for page in pages {
            let value = pick(page).to_lowercase();
            if value.is_empty() {
                continue;
            }
            *map.entry(value).or_insert(0) += 1;
        }
        map
    }

    let titles = groups(pages, |p| p.title.clone());
    let heads = groups(pages, |p| p.h1.clone());

    for page in pages.iter_mut() {
        if titles.get(&page.title.to_lowercase()).copied().unwrap_or(0) > 1 {
            let count = titles[&page.title.to_lowercase()];
            page.issues.push(issue(
                "duplicate_title",
                "warning",
                format!("Deze title staat op {count} pagina's."),
            ));
        }
        if !page.h1.is_empty() && heads.get(&page.h1.to_lowercase()).copied().unwrap_or(0) > 1 {
            let count = heads[&page.h1.to_lowercase()];
            page.issues.push(issue(
                "duplicate_h1",
                "warning",
                format!("Deze H1 staat op {count} pagina's."),
            ));
        }
        page.errors = page.issues.iter().filter(|i| i.severity == "error").count();
        page.warnings = page.issues.iter().filter(|i| i.severity == "warning").count();
        page.score = (100 - (page.errors * 18 + page.warnings * 5).min(100)) as u8;
    }
}

fn task_label(code: &str) -> &'static str {
    match code {
        "http_error" => "Pagina's die niet laden",
        "title_missing" => "Pagina's zonder title",
        "title_short" => "Titels die te kort zijn",
        "title_long" => "Titels die te lang zijn",
        "meta_missing" => "Pagina's zonder meta-omschrijving",
        "meta_short" => "Meta-omschrijvingen die te kort zijn",
        "meta_long" => "Meta-omschrijvingen die te lang zijn",
        "h1_missing" => "Pagina's zonder H1",
        "h1_multiple" => "Meerdere H1's op één pagina",
        "canonical_missing" => "Pagina's zonder canonical",
        "canonical_other" => "Canonicals die naar een andere pagina wijzen",
        "noindex" => "Pagina's die niet geïndexeerd worden",
        "redirect" => "Redirects",
        "img_alt" => "Afbeeldingen zonder alt-tekst",
        "thin_content" => "Pagina's met weinig tekst",
        "slow" => "Trage pagina's",
        "schema_missing" => "Pagina's zonder structured data",
        "schema_invalid" => "Ongeldige structured data",
        "og_missing" => "Pagina's zonder OpenGraph-tags",
        "lang_missing" => "Pagina's zonder taalinstelling",
        "duplicate_title" => "Dubbele titles",
        "duplicate_h1" => "Dubbele H1's",
        "similar_content" => "Pagina's met vergelijkbare inhoud",
        "no_internal_links" => "Pagina's zonder interne links",
        "orphan" => "Pagina's die nergens gelinkt worden",
        "broken_link" => "Kapotte links",
        "internal_redirect" => "Interne links naar een redirect",
        _ => "Overige bevindingen",
    }
}

fn task_impact(code: &str) -> &'static str {
    match code {
        "http_error" | "title_missing" | "h1_missing" | "noindex" | "broken_link" => "high",
        "canonical_missing" | "canonical_other" | "duplicate_title" | "duplicate_h1" | "thin_content"
        | "similar_content" | "orphan" | "internal_redirect" | "redirect" => "medium",
        _ => "low",
    }
}

fn build_tasks(pages: &[AuditPage], links: &[LinkFinding]) -> Vec<Task> {
    let mut grouped: HashMap<String, (String, Vec<String>)> = HashMap::new();
    for page in pages {
        for finding in &page.issues {
            let entry = grouped
                .entry(finding.code.clone())
                .or_insert_with(|| (finding.severity.clone(), Vec::new()));
            entry.1.push(page.url.clone());
        }
    }
    for link in links {
        let code = if link.problem == "broken" { "broken_link" } else { "internal_redirect" };
        let entry = grouped
            .entry(code.to_string())
            .or_insert_with(|| ("error".to_string(), Vec::new()));
        entry.1.push(format!("{} → {}", link.source, link.target));
    }

    let mut tasks: Vec<Task> = grouped
        .into_iter()
        .map(|(code, (severity, mut pages))| {
            pages.sort();
            pages.dedup();
            Task {
                label: task_label(&code).to_string(),
                impact: task_impact(&code).to_string(),
                severity,
                count: pages.len(),
                pages,
                code,
            }
        })
        .collect();
    tasks.sort_by(|a, b| {
        let rank = |impact: &str| match impact {
            "high" => 0,
            "medium" => 1,
            _ => 2,
        };
        rank(&a.impact).cmp(&rank(&b.impact)).then(b.count.cmp(&a.count))
    });
    tasks
}

fn score_of(pages: &[AuditPage]) -> u8 {
    if pages.is_empty() {
        return 0;
    }
    let total: u32 = pages.iter().map(|p| p.score as u32).sum();
    (total / pages.len() as u32) as u8
}

fn base_url(input: &str) -> Result<Url, String> {
    let trimmed = input.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("Vul een site-adres in.".to_string());
    }
    let with_scheme = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    let mut base = Url::parse(&with_scheme).map_err(|_| "Dit is geen geldig adres.".to_string())?;
    base.set_path("/");
    base.set_query(None);
    Ok(base)
}

fn history_path(base: &Url) -> Option<std::path::PathBuf> {
    let host = base.host_str()?.replace([':', '.'], "_");
    let dir = crate::config::config_dir()?.join("audits");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join(format!("{host}.json")))
}

/// Bewaart deze run en geeft de vorige run terug (voor het verschil in score).
pub fn record(result: &AuditResult) -> Option<PreviousRun> {
    let base = Url::parse(&result.base).ok()?;
    let path = history_path(&base)?;
    let mut history: Vec<Snapshot> = std::fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default();
    let previous = history.last().map(|run| PreviousRun {
        at: run.at.clone(),
        score: run.score,
        errors: run.errors,
        warnings: run.warnings,
        crawled: run.crawled,
    });
    history.push(Snapshot {
        at: now_stamp(),
        base: result.base.clone(),
        score: result.score,
        errors: result.pages.iter().map(|p| p.errors).sum(),
        warnings: result.pages.iter().map(|p| p.warnings).sum(),
        crawled: result.crawled,
        pages: result
            .pages
            .iter()
            .map(|p| PageSnapshot {
                url: p.url.clone(),
                status: p.status,
                score: p.score,
                errors: p.errors,
                warnings: p.warnings,
            })
            .collect(),
    });
    if history.len() > KEEP_RUNS {
        let drop = history.len() - KEEP_RUNS;
        history.drain(0..drop);
    }
    if let Ok(json) = serde_json::to_string(&history) {
        let _ = std::fs::write(&path, json);
    }
    previous
}

pub(crate) fn now_stamp() -> String {
    // Zonder extra datumcrate: seconden sinds epoch is genoeg voor de UI,
    // maar een leesbare ISO-string is prettiger. We gebruiken de klok van het systeem.
    let seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days = seconds / 86_400;
    let rest = seconds % 86_400;
    let (year, month, day) = civil_from_days(days as i64);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}Z",
        rest / 3600,
        (rest % 3600) / 60
    )
}

/// Omrekening van dagen sinds 1970 naar kalenderdatum (Howard Hinnant).
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// Crawlt de site en levert per pagina de bevindingen op.
pub async fn audit_site(input: &str, max_pages: usize) -> Result<AuditResult, String> {
    let started = Instant::now();
    let base = base_url(input)?;
    let client = client();

    let mut checks: Vec<SiteCheck> = Vec::new();
    checks.push(SiteCheck {
        label: "HTTPS".to_string(),
        ok: base.scheme() == "https",
        detail: if base.scheme() == "https" {
            "De site draait op https.".to_string()
        } else {
            "De site draait op http.".to_string()
        },
    });

    let robots_body = match get(&client, &base.join("/robots.txt").map_err(|e| e.to_string())?.to_string()).await {
        Ok(robots) if robots.status == 200 => {
            let has_sitemap = robots.body.to_lowercase().contains("sitemap:");
            checks.push(SiteCheck {
                label: "robots.txt".to_string(),
                ok: true,
                detail: if has_sitemap {
                    "Gevonden, met sitemap-verwijzing.".to_string()
                } else {
                    "Gevonden, maar zonder sitemap-verwijzing.".to_string()
                },
            });
            robots.body
        }
        _ => {
            checks.push(SiteCheck {
                label: "robots.txt".to_string(),
                ok: false,
                detail: "Niet gevonden. Google crawlt dan alles wat het vindt.".to_string(),
            });
            String::new()
        }
    };

    let mut seen: HashSet<String> = HashSet::new();
    let mut targets = sitemap_urls(&client, &base, max_pages).await;
    let sitemap_list = targets.clone();
    let sitemap_count = targets.len();
    for url in &targets {
        seen.insert(url.clone());
    }
    checks.push(SiteCheck {
        label: "Sitemap".to_string(),
        ok: sitemap_count > 0,
        detail: if sitemap_count > 0 {
            format!("{sitemap_count} URL's gevonden in de sitemap.")
        } else {
            "Geen sitemap gevonden; de crawler volgt interne links.".to_string()
        },
    });

    let mut truncated = false;
    if targets.len() < max_pages {
        crawl_links(&client, &base, &mut targets, &mut seen, max_pages).await;
    }
    if targets.is_empty() {
        return Err("Geen pagina's gevonden om te controleren.".to_string());
    }
    if targets.len() > max_pages {
        targets.truncate(max_pages);
        truncated = true;
    }

    let mut join_set = tokio::task::JoinSet::new();
    let mut next = 0usize;
    let mut pages: Vec<AuditPage> = Vec::new();
    let mut outbound: HashMap<String, Vec<(String, bool)>> = HashMap::new();
    let mut failed = 0usize;

    while next < targets.len() || !join_set.is_empty() {
        while join_set.len() < CONCURRENCY && next < targets.len() {
            let url = targets[next].clone();
            let worker = client.clone();
            next += 1;
            join_set.spawn(async move {
                let result = get(&worker, &url).await;
                (url, result)
            });
        }
        let Some(joined) = join_set.join_next().await else { break };
        let Ok((url, result)) = joined else { continue };
        match result {
            Ok(fetched) => {
                let Ok(page_url) = Url::parse(&fetched.final_url) else { continue };
                if !fetched.content_type.is_empty() && !fetched.content_type.contains("html") {
                    failed += 1;
                    continue;
                }
                let (page, links) = analyse(&url, &fetched, &page_url);
                outbound.insert(normalize(&url), links);
                pages.push(page);
            }
            Err(_) => failed += 1,
        }
    }

    // Inkomende interne links tellen: een pagina zonder inkomende link is een orphan.
    let crawled: HashSet<String> = pages.iter().map(|p| normalize(&p.url)).collect();
    let mut inbound: HashMap<String, usize> = HashMap::new();
    for links in outbound.values() {
        for (target, internal) in links {
            if *internal && crawled.contains(target) {
                *inbound.entry(target.clone()).or_insert(0) += 1;
            }
        }
    }
    for page in pages.iter_mut() {
        page.inbound = *inbound.get(&normalize(&page.url)).unwrap_or(&0);
    }
    let mut orphans: Vec<String> = pages
        .iter()
        .filter(|p| p.inbound == 0 && normalize(&p.url) != normalize(base.as_str()))
        .map(|p| p.url.clone())
        .collect();
    orphans.sort();
    for page in pages.iter_mut() {
        if orphans.contains(&page.url) {
            page.issues.push(issue("orphan", "warning", "Geen interne link naar deze pagina.".to_string()));
        }
    }

    // Links naar pagina's buiten de crawl (en externe links) controleren.
    let mut to_check: Vec<(String, String, bool)> = Vec::new();
    let mut unique: HashSet<String> = HashSet::new();
    for (source, links) in &outbound {
        for (target, internal) in links {
            if *internal && crawled.contains(target) {
                continue;
            }
            if unique.insert(target.clone()) {
                to_check.push((source.clone(), target.clone(), *internal));
            }
        }
    }
    to_check.truncate(MAX_LINK_CHECKS);

    let mut findings: Vec<LinkFinding> = Vec::new();
    let mut link_set = tokio::task::JoinSet::new();
    let mut index = 0usize;
    let mut results: Vec<(String, String, u16, String)> = Vec::new();
    while index < to_check.len() || !link_set.is_empty() {
        while link_set.len() < CONCURRENCY && index < to_check.len() {
            let (_, target, _) = to_check[index].clone();
            let worker = client.clone();
            index += 1;
            link_set.spawn(async move {
                let outcome = get(&worker, &target).await;
                (target, outcome)
            });
        }
        let Some(joined) = link_set.join_next().await else { break };
        let Ok((target, outcome)) = joined else { continue };
        if let Ok(fetched) = outcome {
            results.push((target, fetched.final_url, fetched.status, String::new()));
        }
    }
    for (source, target, internal) in &to_check {
        let Some((_, final_url, status, _)) = results.iter().find(|(t, _, _, _)| t == target) else { continue };
        let kind = if *internal { "internal" } else { "external" };
        if *status >= 400 {
            findings.push(LinkFinding {
                source: source.clone(),
                target: target.clone(),
                kind: kind.to_string(),
                status: *status,
                problem: "broken".to_string(),
            });
        } else if *internal && normalize(final_url) != normalize(target) {
            findings.push(LinkFinding {
                source: source.clone(),
                target: target.clone(),
                kind: kind.to_string(),
                status: *status,
                problem: "redirect".to_string(),
            });
        }
    }

    mark_duplicates(&mut pages);
    strip_boilerplate(&mut pages);
    mark_similar(&mut pages);
    pages.sort_by(|a, b| {
        b.errors
            .cmp(&a.errors)
            .then(b.warnings.cmp(&a.warnings))
            .then(a.url.cmp(&b.url))
    });

    let sitemap = build_sitemap_report(&sitemap_list, &pages);
    let crawl_budget = build_crawl_budget(&targets, soft_404_probes(&client, &base).await);
    let ai_crawlers = check_ai_crawlers(&pages, base.as_str(), &robots_body).await;

    let tasks = build_tasks(&pages, &findings);
    let score = score_of(&pages);

    if !sitemap.not_found.is_empty() || !sitemap.redirected.is_empty() {
        checks.push(SiteCheck {
            label: "Sitemap-URL's".to_string(),
            ok: false,
            detail: format!(
                "{} URL uit de sitemap geeft een fout, {} verwijst door.",
                sitemap.not_found.len(),
                sitemap.redirected.len()
            ),
        });
    }
    if !crawl_budget.traps.is_empty() {
        checks.push(SiteCheck {
            label: "Crawl-budget".to_string(),
            ok: false,
            detail: format!(
                "{} patroon gedraagt zich als URL-trap: {}.",
                crawl_budget.traps.len(),
                crawl_budget.traps.first().map(|trap| trap.label.clone()).unwrap_or_default()
            ),
        });
    }
    if let Some(worst) = ai_crawlers.iter().find(|bot| bot.has_problems()) {
        checks.push(SiteCheck {
            label: "AI-crawlers".to_string(),
            ok: false,
            detail: worst.summary(),
        });
    } else if !ai_crawlers.is_empty() {
        checks.push(SiteCheck {
            label: "AI-crawlers".to_string(),
            ok: true,
            detail: "Alle geteste AI-crawlers zien dezelfde pagina's.".to_string(),
        });
    }

    Ok(AuditResult {
        base: base.to_string(),
        crawled: pages.len(),
        failed,
        truncated,
        sitemap_urls: sitemap_count,
        duration_ms: started.elapsed().as_millis() as u64,
        score,
        tasks,
        links: findings,
        orphans,
        checks,
        ai_crawlers,
        sitemap,
        crawl_budget,
        previous: None,
        pages,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_page(url: &str, status: u16) -> AuditPage {
        let fetched = Fetched {
            status,
            final_url: url.to_string(),
            body: "<html lang=\"nl\"><head><title>Een redelijk lange titel voor de test</title></head><body><h1>Kop</h1><p>wat tekst</p></body></html>".to_string(),
            content_type: "text/html".to_string(),
            ms: 20,
        };
        let (page, _) = analyse(url, &fetched, &Url::parse("https://example.com/").unwrap());
        page
    }

    #[test]
    fn leest_loc_urls_uit_een_sitemap() {
        let xml = "<urlset><url><loc>https://example.com/a</loc></url><url><loc>https://example.com/b?x=1&amp;y=2</loc></url></urlset>";
        assert_eq!(extract_locs(xml), vec!["https://example.com/a", "https://example.com/b?x=1&y=2"]);
    }

    #[test]
    fn slaat_afbeeldingen_en_pdf_over() {
        let base = Url::parse("https://example.com/").unwrap();
        assert!(is_crawlable(&Url::parse("https://example.com/pagina").unwrap()));
        assert!(!is_crawlable(&base.join("/foto.jpg").unwrap()));
        assert!(!is_crawlable(&Url::parse("mailto:info@example.com").unwrap()));
    }

    #[test]
    fn telt_problemen_per_pagina() {
        let fetched = Fetched {
            status: 200,
            final_url: "https://example.com/".to_string(),
            body: "<html><head><title>Kort</title></head><body><p>te weinig tekst</p></body></html>".to_string(),
            content_type: "text/html".to_string(),
            ms: 100,
        };
        let (page, _) = analyse("https://example.com/", &fetched, &Url::parse("https://example.com/").unwrap());
        assert_eq!(page.title, "Kort");
        assert!(page.issues.iter().any(|i| i.code == "title_short"));
        assert!(page.issues.iter().any(|i| i.code == "h1_missing"));
        assert!(page.errors >= 1);
        assert!(page.score < 100);
    }

    #[test]
    fn vergelijkt_inhoud_met_shingles() {
        let a = shingles_of("de beste dj voor een bruiloft in amsterdam met live muziek en licht");
        let b = shingles_of("de beste dj voor een bruiloft in amsterdam met live muziek en licht");
        let c = shingles_of("iets heel anders over duikbrillen en onderwaterfotografie");
        assert!(overlap(&a, &b).0 > 0.9);
        assert!(overlap(&a, &c).0 < 0.2);
    }

    #[test]
    fn groepeert_bevindingen_in_taken() {
        let fetched = Fetched {
            status: 200,
            final_url: "https://example.com/".to_string(),
            body: "<html lang=\"nl\"><head><title>Korte titel</title><meta property=\"og:title\" content=\"x\"></head><body><p>tekst</p></body></html>".to_string(),
            content_type: "text/html".to_string(),
            ms: 100,
        };
        let (page, _) = analyse("https://example.com/", &fetched, &Url::parse("https://example.com/").unwrap());
        let tasks = build_tasks(&[page], &[]);
        assert!(tasks.iter().any(|t| t.code == "h1_missing" && t.impact == "high"));
        assert!(tasks.iter().any(|t| t.code == "og_missing"));
    }

    #[test]
    fn score_is_het_gemiddelde_van_de_pagina_scores() {
        let fetched = Fetched {
            status: 200,
            final_url: "https://example.com/".to_string(),
            body: "<html lang=\"nl\"><head><title>Een redelijk lange titel voor de test</title></head><body><h1>Kop</h1></body></html>".to_string(),
            content_type: "text/html".to_string(),
            ms: 100,
        };
        let (page, _) = analyse("https://example.com/", &fetched, &Url::parse("https://example.com/").unwrap());
        let score = score_of(std::slice::from_ref(&page));
        assert_eq!(score, page.score);
    }

    #[test]
    fn herkent_robots_blokkade_voor_ai_crawlers() {
        let robots = "User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nAllow: /";
        assert!(robots_blocks(robots, "GPTBot"));
        assert!(!robots_blocks(robots, "PerplexityBot"));
    }

    #[test]
    fn robots_wildcard_geldt_voor_iedere_bot() {
        assert!(robots_blocks("User-agent: *\nDisallow: /", "CCBot"));
        assert!(!robots_blocks("User-agent: *\nDisallow: /admin", "CCBot"));
    }

    #[test]
    fn vergelijkt_sitemap_met_de_crawl() {
        let sitemap = vec![
            "https://example.com/".to_string(),
            "https://example.com/bestaat-niet".to_string(),
            "https://example.com/oud".to_string(),
            "https://example.com/alleen-sitemap".to_string(),
        ];
        let pages = vec![
            test_page("https://example.com/", 200),
            test_page("https://example.com/bestaat-niet", 404),
            test_page("https://example.com/nergens", 200),
        ];
        let report = build_sitemap_report(&sitemap, &pages);
        assert!(report.found);
        assert_eq!(report.urls, 4);
        assert!(report.not_found.iter().any(|entry| entry.contains("/bestaat-niet")));
        assert_eq!(report.missing_from_crawl_total, 2);
        assert!(report.missing_from_crawl.iter().any(|url| url.ends_with("/alleen-sitemap")));
        assert!(report.not_in_sitemap.iter().any(|url| url.ends_with("/nergens")));
    }

    #[test]
    fn herkent_url_traps_en_parametertelling() {
        let urls = vec![
            "https://example.com/".to_string(),
            "https://example.com/zwembad".to_string(),
            "https://example.com/?e-page-abc=1".to_string(),
            "https://example.com/?e-page-def=2".to_string(),
            "https://example.com/?e-page-ghi=3".to_string(),
            "https://example.com/?s=test".to_string(),
            "https://example.com/?replytocom=12".to_string(),
        ];
        let budget = build_crawl_budget(&urls, Vec::new());
        assert_eq!(budget.total, 7);
        assert_eq!(budget.with_params, 5);
        assert!(budget.param_share_pct > 70.0);
        let trap = budget
            .traps
            .iter()
            .find(|trap| trap.pattern.contains("e-page"))
            .expect("Elementor-trap");
        assert_eq!(trap.count, 3);
        assert!(trap.robots.contains("Disallow"));
        assert!(budget.advice.iter().any(|line| line.contains("e-page")));
    }

    #[test]
    fn kapt_lange_tekst_af() {
        assert_eq!(shorten("kort", 10), "kort");
        let afgekapt = shorten("abcdefghij", 5);
        assert_eq!(afgekapt.chars().count(), 5);
        assert!(afgekapt.ends_with('…'));
    }

    /// Echte crawl tegen een live site: `cargo test live_audit -- --ignored --nocapture`.
    #[tokio::test]
    #[ignore]
    async fn live_audit() {
        let result = audit_site("https://white-vision.nl", 8).await.expect("audit");
        println!(
            "{} pagina's, score {}, {} taken, {} linkproblemen, {} orphans in {} ms",
            result.crawled,
            result.score,
            result.tasks.len(),
            result.links.len(),
            result.orphans.len(),
            result.duration_ms
        );
        for task in &result.tasks {
            println!("{:>6} {:>3} pagina's  {}", task.impact, task.count, task.label);
        }
        assert!(!result.pages.is_empty());
        assert!(result.score <= 100);
    }
}
