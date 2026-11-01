// Uit vite.config.ts geïnjecteerd: bouw-tijdstempel en commit waarmee de frontend
// is gebouwd. Dient herkenbaarheid van de actuele build, vooral tijdens dev.
declare const __BUILD__: { sha: string; date: string };
