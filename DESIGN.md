# Adlytica — ontwerpsysteem

Dit document beschrijft de visuele wereld van de app: waar de keuzes vandaan
komen, welke tokens er zijn en welke regels gelden als je iets toevoegt. De
functionele beschrijving staat in [README.md](README.md).

## De wereld

**Het meetinstrument en het grootboek.** Adlytica is geen marketingdashboard
maar een meetbank: elke pagina is een kolom met getallen die je naast elkaar
legt en vergelijkt, en de uitkomst gaat als rapport naar een klant. Daar hoort
een koude, precieze grond bij met haarlijnen in plaats van schaduwen,
tabelcijfers in plaats van gladde percentages, en één interactiekleur die
nergens anders voor gebruikt wordt.

De app werkt in een donkere kamer, uren achter elkaar, met vier databronnen
naast elkaar. Vandaar een donkere grond — niet omdat dashboards nu eenmaal
donker zijn, maar omdat je hier lang naar kijkt en de cijfers de enige lichtbron
horen te zijn.

Twee dingen zijn bewust wél gebleven en bewust niet: de bestaande schermen,
functies en Nederlandse teksten blijven zoals ze zijn; het oude uiterlijk (amber
op GitHub-donker, unicode-pijltjes als iconen, veertien losse lettergroottes)
is vervangen en niet opgepoetst.

## Kleur

Vier rollen, en ze mogen elkaar niet aflossen.

| Rol | Token | Waarde | Waar |
|---|---|---|---|
| Interactie | `--accent` | `#3d93f0` | selectie, focus, links, actieve navigatie, primaire knop |
| Aandacht | `--gold` | `#e6a53c` | geld, verlies, risico, waarschuwing, "wat opvalt" |
| Winst | `--gain` | `#35c98f` | alleen de richting van een cijfer (omhoog) |
| Verlies | `--loss` | `#f47171` | alleen de richting van een cijfer (omlaag), en fouten |

**Blauw raakt nooit data.** De grote KPI-cijfers zijn dan ook `--ink`, niet
gekleurd: een bedrag van € 3.608 hoort niet te schreeuwen omdat het toevallig
een bedrag is. Amber betekent iets, dus het mag niet ook "geselecteerd" of
"merk" betekenen — dat was precies de verwarring in het oude palet, waar amber
tegelijk accent, KPI-kleur én (via een fout in de CSS) de blauwe badge was.

De grond is op het merkblauw getint (`#070a11` → `#0c1119` → `#111823` →
`#17202e`, hue ≈ 215). Daardoor leest de app als één materiaal met het logo in
plaats van als een grijs dashboard waar toevallig een blauw logo in staat.

### Reekskleuren in grafieken

De kleur zegt uit welke bron het cijfer komt, in elke grafiek opnieuw:

- organisch (Search Console) → `--series-1` blauw
- betaald (Google Ads) → `--series-2` amber
- GA4 → `--series-3` violet
- losse reeksen (Google Trends) → `SERIES_RAMP` in `src/lib/chartTheme.ts`,
  bewust zonder mint en rood: die twee betekenen hier al winst en verlies.

## Lettertypes

Lokaal meegesleept in `public/fonts` (één variabel woff2-bestand per familie,
samen ~70 kB) — een desktop-app hoort niet van een CDN af te hangen.

- **Schibsted Grotesk** — alle tekst, koppen en tabelcijfers.
- **Geist Mono** — micro-labels, kolomkoppen, bronlabels, bijschriften,
  tijdstempels, aslabels en toetsenbordhints.

De mono is geen decoratie maar een rol: alles wat een *meting* benoemt staat in
het mono, alles wat je *leest* in de grotesk. Het `.mono-label`-blok in
`styles.css` zet die rol in één keer goed. Gebruik het niet voor kopjes van
kaarten: die zijn gewone tekst op 13 px.

## Maatvoering

- Radii: 4 / 6 / 9 / 12 / 16 px + `999px` voor pillen.
- Basistekst 13 px, tabeltekst 12–12,5 px, micro-labels 9,5–10,5 px,
  KPI-waarde 27 px, paginakop 21 px.
- Schaduwen alleen voor echte lagen (paneel, commandopalet, plakkende balk).
  Kaarten en widgets worden gescheiden door grond en haarlijn, niet door
  schaduw.
- Inkt in vier trappen, elk ≥ 4,5:1 op zijn oppervlak:

| Token | Waarde | Contrast op `--surface` | Contrast op `--bg` |
|---|---|---|---|
| `--ink` | `#e8eef7` | 16,2:1 | 17,0:1 |
| `--ink-2` | `#a7b4c6` | 9,0:1 | 9,4:1 |
| `--ink-3` | `#8296ad` | 6,2:1 | 6,5:1 |
| `--ink-4` | `#6f8098` | 4,7:1 | 4,9:1 |

`--ink-4` is voor rustige labels (groepskoppen, versie, hint) — nooit voor
informatie die je moet kunnen lezen om de app te gebruiken, en niet op
`--surface-3` (daar zakt hij naar 4,1:1). De rolkleuren halen het ook:
`--accent` 6,0:1, `--gold` 8,8:1, `--gain` 8,9:1, `--loss` 6,7:1, en wit op de
primaire knop 5,2:1.

Eén eerlijke kanttekening: de rand van een secundaire knop haalt 2,0:1 en
daarmee niet de 3:1 die WCAG 1.4.11 voor een bedieningsoppervlak vraagt. Op een
donkere grond is dat alleen op te lossen met randen die zwaar gaan wegen; de
knop leest hier op vulling (`--surface-2`), rand en tekst samen. Wie hier streng
op wil zijn, verhoogt `--line-3` — met de wetenschap dat elke secundaire knop
dan een stuk luidruchtiger wordt.

## Beweging

Eén authored moment: bij het wisselen van scherm komt de pagina 7 px omhoog en
vaagt in (300 ms, `cubic-bezier(0.16, 1, 0.3, 1)`), met een kleine trap op de
eerste widgets. Verder is beweging functioneel: de spinner bij verversen, de
schuivende Adly-laag. Alles staat uit bij `prefers-reduced-motion`.

## Browser-eigen oppervlakken

Selectie, cursor, scrollbalken en focusringen staan in het thema. Dat is het
goedkoopste signaal dat een scherm gebouwd is in plaats van samengesteld:
`::selection` in het merkblauw, dunne scrollbalken in `#22303f`, en een
focusring van 2 px met 2 px offset op alles wat met het toetsenbord te bereiken
is. De standaard `outline` van de browser wordt nergens onderdrukt zonder
vervanging.

## Iconen

`src/components/Icon.tsx` is de enige bron van iconen: 20×20 raster, 1,4 px
streek, ronde uiteinden, `currentColor`. Geen unicode-glyphs — die vallen per
besturingssysteem anders uit en wegen onderling niet hetzelfde. Een nieuw icoon
teken je op dat raster; een tweede iconenbibliotheek ernaast is een fout.

## Regels voor het toevoegen van iets

1. **Cijfers rechts, tekst links.** Numerieke cellen krijgen `className="num"`
   (tabulaire cijfers, rechts uitgelijnd). Dit is geen detail: de halve app is
   een kolom met getallen die je vergelijkt.
2. **Tabelkoppen in mono, kaartkoppen in tekst.** Zie het mono-label-blok.
3. **Geen gekleurde randen aan kaarten.** Een betekenisvolle status gebruik je
   via `.card.notice`, `.card.alert` of `.card.danger` — een haarlijn in de
   rolkleur plus een zachte was; niet via een dikke linkerrand.
4. **Geld krijgt een valutasymbool.** `€ 3.608`, niet `3.608`.
5. **Een lege toestand is een ontworpen toestand.** Gebruik `.widget-empty`,
   `.dash-empty` of een `.hint`-regel met de reden, niet een leeg vlak.
6. **Datumnotatie is Nederlands en overal gelijk**: `15 aug` in assen en in de
   topbalk, `5 aug – 2 nov` voor een bereik.

## Ontwikkelen zonder backend

De app praat via `invoke()` met de Rust-kant, dus in een gewone browser blijft
elke view leeg. Voor ontwerpwerk is er `npm run dev:mock`: dat start de app met
`dev/mock-tauri.ts` in plaats van de Tauri-brug, met deterministische
voorbeeldcijfers (inclusief een daling in de laatste week, zodat de
anomaliewidgets en het alertblok gevuld zijn). De gewone `npm run dev` en de
Tauri-build gebruiken de echte brug; `dev/` en `vite.mock.config.ts` zijn
gereedschap en horen niet in de applicatie zelf.
