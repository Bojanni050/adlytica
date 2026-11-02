/**
 * Schakelt het wit-label-blok (eigen naam, accentkleur, voettekst en logo) in of uit.
 * De implementatie blijft staan; op `false` gebruikt de app altijd de vaste
 * Adlytica-naam en het eigen merkteken, ook als er al branding in config.json
 * staat. Let op: een eigen accentkleur uit config.json overschrijft `--accent`,
 * waar ook de focusring, de selectie en de actieve navigatie op staan — kies
 * dus een kleur die op de donkere grond genoeg contrast houdt.
 */
export const WHITE_LABEL_ENABLED = false;
