# Adlytica — SEO & Ads Command Center

Desktop app (Tauri + React) die Google Analytics 4, Google Search Console, Google Ads en Google Trends verenigt in één werkplek. Data wordt opgehaald via de Windsor.ai API; Google Trends via een lokale Python-sidecar (pytrends).

## Functies

- **Dashboard** — samenvatting en dagelijkse trends uit GA4, Search Console en Google Ads over 7, 30, 90 of 180 dagen, met periodevergelijking; de kaarten zijn losse widgets die je zelf verplaatst, verbergt en weer aanzet
- **Keyword Search** — eigen zoektermen uit Search Console (klikken, impressies, CTR, positie) én Keyword Planner-ideeën uit Google Ads (volume, competitie, biedranges)
- **Posities** — volg zoektermen en zie hun Search Console-positie per dag als grafiek, met weekdaling/stijging en een sparkline per term; historie wordt lokaal bewaard in `rankings.json`
- **SEO Analyse** — best presterende pagina's, zoektermen per pagina en automatisch gedetecteerde kansen (positie 5–20)
- **Advertenties** — campagne-overzicht (30 dagen, inclusief gepauzeerd), pauzeren/activeren en nieuwe campagnes + ad groups aanmaken
- **Google Trends** — zoekinteresse over tijd en gerelateerde/opkomende zoektermen (via pytrends)
- **Adly (AI-assistent)** — chat met je AI-collega voor SEO-advies en campagnehulp; verstuurt optioneel je actuele Search Console- en campagnedata mee voor data-gedreven antwoorden (Mistral API)

## Vereisten

- Node.js 18+ en npm
- Rust toolchain (rustup) — nodig voor Tauri
- Python 3.9+ met `pytrends`: `pip install pytrends`
- Een Windsor.ai-account met verbonden Google Analytics 4, Search Console en Google Ads connectors, en een API-key (Windsor.ai → Settings → API)
- Voor Adly (AI): een Mistral API-key van console.mistral.ai

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

## Structuur

```
src/                  React-frontend (views, components, lib)
src-tauri/src/        Rust-backend: windsor.rs (API-client), trends.rs (sidecar), lib.rs (Tauri-commando's)
src-tauri/trends_sidecar.py  Python JSON-over-stdin sidecar voor pytrends
```

## Beveiliging

De API-key blijft lokaal in de app; alle calls gaan direct naar `connectors.windsor.ai`. Er worden geen gegevens gedeeld met derden.
