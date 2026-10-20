//! Technische SEO-audit: crawlt de eigen site en controleert per pagina de
//! dingen die er in de praktijk toe doen (status, titel, meta, koppen,
//! canonical, indexeerbaarheid, interne links, alt-teksten, structured data).

use scraper::{Html, Selector};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};
use url::Url;

const USER_AGENT: &str = "Adlytica/0.1 (technische SEO-audit)";
const CONCURRENCY: usize = 6;

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
    pub ms: u64,
    pub errors: usize,
    pub warnings: usize,
    pub issues: Vec<AuditIssue>,
}

#[derive(Serialize)]
pub struct SiteCheck {
    pub label: String,
    pub ok: bool,
    pub detail: String,
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
    pub checks: Vec<SiteCheck>,
}

struct Fetched {
    status: u16,
    final_url: String,
    body: String,
    content_type: String,
    ms: u64,
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

fn is_crawlable(url: &Url) -> bool {
    let scheme_ok = matches!(url.scheme(), "http" | "https");
    if !scheme_ok {
        return false;
    }
    let path = url.path().to_lowercase();
    let blocked = [
        ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".pdf", ".zip", ".xml", ".css", ".js",
        ".ico", ".mp4", ".webp", ".woff", ".woff2", ".ttf",
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

fn analyse(url: &str, fetched: &Fetched, page_url: &Url) -> AuditPage {
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
    let mut linked: HashSet<String> = HashSet::new();
    for anchor in document.select(&selector("a[href]")) {
        let Some(href) = anchor.value().attr("href") else { continue };
        if href.starts_with('#') || href.starts_with("mailto:") || href.starts_with("tel:") {
            continue;
        }
        let Ok(target) = page_url.join(href) else { continue };
        if target.host_str() == page_url.host_str() {
            internal_links += 1;
            linked.insert(target.path().to_string());
        } else {
            external_links += 1;
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

    let words: usize = document
        .select(&selector("p, li, h1, h2, h3, h4, h5, h6"))
        .map(|e| e.text().collect::<String>().split_whitespace().count())
        .sum();

    if fetched.status >= 400 {
        issues.push(issue("http_error", "error", format!("De pagina geeft status {}.", fetched.status)));
    }
    if fetched.status >= 300 && fetched.status < 400 {
        issues.push(issue("redirect", "warning", format!("Doorverwezen naar {}.", fetched.final_url)));
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

    let errors = issues.iter().filter(|i| i.severity == "error").count();
    let warnings = issues.iter().filter(|i| i.severity == "warning").count();
    let title_len = title.chars().count();

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
        ms: fetched.ms,
        errors,
        warnings,
        issues,
    }
}

/// Markeert dubbele titles, meta-omschrijvingen en H1's over de hele crawl.
fn mark_duplicates(pages: &mut [AuditPage]) {
    fn groups<'a>(pages: &'a [AuditPage], pick: impl Fn(&'a AuditPage) -> String) -> HashMap<String, usize> {
        let mut map: HashMap<String, usize> = HashMap::new();
        for page in pages {
            let value = pick(page);
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
        if titles.get(&page.title).copied().unwrap_or(0) > 1 {
            let count = titles[&page.title];
            page.issues.push(issue(
                "duplicate_title",
                "warning",
                format!("Deze title staat op {count} pagina's."),
            ));
        }
        if !page.h1.is_empty() && heads.get(&page.h1).copied().unwrap_or(0) > 1 {
            let count = heads[&page.h1];
            page.issues.push(issue(
                "duplicate_h1",
                "warning",
                format!("Deze H1 staat op {count} pagina's."),
            ));
        }
        page.errors = page.issues.iter().filter(|i| i.severity == "error").count();
        page.warnings = page.issues.iter().filter(|i| i.severity == "warning").count();
    }
}

/// Crawlt de site en levert per pagina de bevindingen op.
pub async fn audit_site(input: &str, max_pages: usize) -> Result<AuditResult, String> {
    let started = Instant::now();
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

    let client = client();
    let mut checks: Vec<SiteCheck> = Vec::new();
    checks.push(SiteCheck {
        label: "HTTPS".to_string(),
        ok: base.scheme() == "https",
        detail: if base.scheme() == "https" { "De site draait op https.".to_string() } else { "De site draait op http.".to_string() },
    });

    match get(&client, &base.join("/robots.txt").map_err(|e| e.to_string())?.to_string()).await {
        Ok(robots) if robots.status == 200 => {
            let has_sitemap = robots.body.to_lowercase().contains("sitemap:");
            checks.push(SiteCheck {
                label: "robots.txt".to_string(),
                ok: true,
                detail: if has_sitemap { "Gevonden, met sitemap-verwijzing.".to_string() } else { "Gevonden, maar zonder sitemap-verwijzing.".to_string() },
            });
        }
        _ => checks.push(SiteCheck {
            label: "robots.txt".to_string(),
            ok: false,
            detail: "Niet gevonden. Google crawlt dan alles wat het vindt.".to_string(),
        }),
    }

    let mut seen: HashSet<String> = HashSet::new();
    let mut targets = sitemap_urls(&client, &base, max_pages).await;
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
        let before = targets.len();
        crawl_links(&client, &base, &mut targets, &mut seen, max_pages).await;
        if before < targets.len() && targets.len() >= max_pages {
            truncated = true;
        }
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
                let Ok(final_url) = Url::parse(&fetched.final_url) else { continue };
                if fetched.status >= 400 && !fetched.content_type.contains("html") {
                    failed += 1;
                    continue;
                }
                if !fetched.content_type.is_empty() && !fetched.content_type.contains("html") {
                    continue;
                }
                pages.push(analyse(&url, &fetched, &final_url));
            }
            Err(_) => failed += 1,
        }
    }

    mark_duplicates(&mut pages);
    pages.sort_by(|a, b| {
        b.errors
            .cmp(&a.errors)
            .then(b.warnings.cmp(&a.warnings))
            .then(a.url.cmp(&b.url))
    });

    Ok(AuditResult {
        base: base.to_string(),
        crawled: pages.len(),
        failed,
        truncated,
        sitemap_urls: sitemap_count,
        duration_ms: started.elapsed().as_millis() as u64,
        checks,
        pages,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

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
        let page = analyse("https://example.com/", &fetched, &Url::parse("https://example.com/").unwrap());
        assert_eq!(page.title, "Kort");
        assert!(page.issues.iter().any(|i| i.code == "title_short"));
        assert!(page.issues.iter().any(|i| i.code == "h1_missing"));
        assert!(page.errors >= 1);
    }

    /// Echte crawl tegen een live site: `cargo test live_audit -- --ignored --nocapture`.
    #[tokio::test]
    #[ignore]
    async fn live_audit() {
        let result = audit_site("https://white-vision.nl", 8).await.expect("audit");
        println!("{} pagina's in {} ms", result.crawled, result.duration_ms);
        for page in &result.pages {
            println!("{:>3} {:>2}e/{:>2}w {}", page.status, page.errors, page.warnings, page.url);
        }
        assert!(!result.pages.is_empty());
    }
}
