# Adlytica — SEO & Ads Command Center

Desktop app (Tauri + React) die Google Analytics 4, Google Search Console, Google Ads en Google Trends verenigt in één werkplek. Data wordt opgehaald via de Windsor.ai API; Google Trends via een lokale Python-sidecar (pytrends).

## Functies

- **Dashboard** — samenvatting en dagelijkse trends uit GA4, Search Console en Google Ads over 7, 30, 90 of 180 dagen, met periodevergelijking; de kaarten zijn losse widgets die je zelf verplaatst, verbergt en weer aanzet
- **Anomalieën** — twee widgets op het dashboard die pagina's en zoektermen tonen waarvan de klikken week-op-week met 30% of meer zijn gezakt (alleen items met minstens 5 klikken in de week ervoor), gesorteerd op het aantal verloren klikken
- **Keyword Search** — eigen zoektermen uit Search Console (klikken, impressies, CTR, positie) én Keyword Planner-ideeën uit Google Ads (volume, competitie, biedranges); bij de ideeën zie je meteen je eigen positie en filter je op **nog niet**, **buiten top 20** of **in top 20** (gratis keyword gap, zonder concurrent-data); AI clustert de keywords op thema en intentie
- **Posities** — volg zoektermen en zie hun Search Console-positie per dag als grafiek, met weekdaling/stijging en een sparkline per term; historie wordt lokaal bewaard in `rankings.json`
- **Cannibalisatie** — widget die zoektermen toont waar meerdere pagina's samen vertoningen pakken (minstens 200 vertoningen, en de tweede pagina haalt minstens 15% van de eerste), met per pagina de positie als pil (mint voor top 3, amber voor pagina 1), gesorteerd op totale vertoningen
- **SEO Analyse** — best presterende pagina's, zoektermen per pagina en automatisch gedetecteerde kansen (positie 5–20); per pagina opent de knop **Rank Math** een paneel waarin je de SEO-titel en meta-omschrijving bekijkt en direct naar WordPress wegschrijft
- **Zoekanalyse** — laatste 30 dagen naast de 30 dagen daarvoor: CTR-curve per positie uit je eigen cijfers, low-hanging fruit (positie 11–20) met geschatte klikwinst, nieuwe en verloren zoektermen, merk vs niet-merk, groeiende en dalende pagina's en verkeersbronnen uit GA4
- **Snelheid** — PageSpeed Insights-meting per pagina (mobiel of desktop): scores voor performance, toegankelijkheid, best practices en SEO, de kerncijfers (FCP, LCP, TBT, CLS, snelheidsindex, serverreactie) en de verbeterpunten met geschatte winst; vraagt een gratis Google API-key
- **Audit** — crawlt je eigen site (sitemap of interne links) en controleert per pagina status, redirects, title- en meta-lengte, H1's, canonical, noindex, interne en externe links, alt-teksten, OpenGraph, hreflang, woorden, JSON-LD en reactietijd; **health score** met verschil met de vorige run (geschiedenis in de app-data), **taken** gegroepeerd per probleem met impact en aantal pagina's, **site-structuur** als URL-boom met klikken uit Search Console en labels `noindex`/`canonicalized`/`404`/`orphan`, plus detectie van orphans, kapotte links, interne redirects en vergelijkbare inhoud; PDF-export
- **Advertenties** — campagne-overzicht (30 dagen, inclusief gepauzeerd), pauzeren/activeren en nieuwe campagnes + ad groups aanmaken
- **Zoektermen** — zoektermen uit Google Ads met kosten en conversies, beoordeeld als negative-kandidaat (minimaal €1 kosten en nul conversies); vink ze aan en push ze per campagne als negative keyword (broad, phrase of exact), of kopieer de lijst voor handmatige invoer
- **Budget** — pacing per campagne voor de huidige maand: dagbudget, besteed-bedrag, verwacht bedrag tot nu, projectie naar het einde van de maand en een balk met de verhouding (rood over, geel onder, groen op schema)
- **Google Trends** — zoekinteresse over tijd en gerelateerde/opkomende zoektermen (via pytrends)
- **Adly (AI-assistent)** — chat met je AI-collega voor SEO-advies en campagnehulp; verstuurt optioneel je actuele Search Console- en campagnedata mee voor data-gedreven antwoorden (Mistral API)
- **Wit-label** — eigen app-naam, accentkleur, voettekst en logo (png/jpeg/webp/svg tot 400 kB) instellen bij Instellingen; logo wordt als data-URL in `config.json` bewaard en de accentkleur werkt direct door in menu, knoppen en randen
- **Meldingen** — Windows-melding zodra het dashboard pagina's of zoektermen vindt die week-op-week 30% of meer zijn gezakt (maximaal één per dag); aan/uit te zetten bij Instellingen, met een testknop
- **PDF-rapporten** — de knop **⬇ PDF** op het dashboard en bij Budget bouwt een eigen rapport (kerncijfers, top pagina's en zoektermen, dalingen of pacing) en schrijft dat naar je map Downloads; de app meldt het volledige pad
- **Snel navigeren** — druk op Ctrl+K (of gebruik "Snel naar…" in de zijbalk) om met je toetsenbord naar elke view te springen

## Vereisten

- Node.js 18+ en npm
- Rust toolchain (rustup) — nodig voor Tauri
- Python 3.9+ met `pytrends`: `pip install pytrends`
- Een Windsor.ai-account met verbonden Google Analytics 4, Search Console en Google Ads connectors, en een API-key (Windsor.ai → Settings → API)
- Voor Adly (AI): een Mistral API-key van console.mistral.ai
- Voor de WordPress/Rank Math-koppeling: een WordPress-gebruiker met redactierechten en een **applicatiewachtwoord** (Gebruikers → Profiel → Applicatiewachtwoorden). Je gebruikersnaam is je inlognaam, niet je e-mailadres.

## Installatie

```bash
npm install
cd src-tauri && cargo build
```

## App iconen

Tauri vereist een icoon. Genereer `src-tauri/icons/icon.png` (minimaal 512×512):

```bash
npm run tauri icon src-tauri/icons/source.png
```

## Gebruik

```bash
npm run tauri dev    # ontwikkelmodus
npm run tauri build  # productiebuild (.deb/.msi/.app)
```

1. Ga naar **Instellingen** en vul je Windsor.ai API-key in (accounts worden vooringesteld maar kunnen daar aangepast worden).
2. Zorg dat `python3` (of het pad naar je Python) beschikbaar is voor de Trends-sidecar.
3. Voor de Rank Math-koppeling: vul bij **WordPress (Rank Math)** de site-URL, gebruikersnaam en het applicatiewachtwoord in en klik op **Verbinding testen**. Daarna schrijf je vanuit SEO Analyse per pagina de titel en meta-omschrijving weg naar WordPress.

## Structuur

```
src/                  React-frontend (views, components, lib)
src-tauri/src/        Rust-backend: windsor.rs (API-client), wordpress.rs (Rank Math via WP-REST), rankings.rs (positiehistorie), trends.rs (sidecar), config.rs (config.json), lib.rs (Tauri-commando's)
src-tauri/trends_sidecar.py  Python JSON-over-stdin sidecar voor pytrends
```

## Beveiliging

De API-key blijft lokaal in de app; alle calls gaan direct naar `connectors.windsor.ai`. Er worden geen gegevens gedeeld met derden. Hetzelfde geldt voor de WordPress-gegevens: gebruikersnaam en applicatiewachtwoord worden lokaal in `config.json` bewaard en alleen gebruikt voor calls naar je eigen site.
