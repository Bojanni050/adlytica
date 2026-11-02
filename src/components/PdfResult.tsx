import React from "react";
import { openPath, revealPath } from "../lib/api";

interface Props {
  /** Pad van het zojuist opgeslagen PDF-bestand. */
  path: string | null;
  /** Melding boven de knoppen; standaard "Opgeslagen: <pad>". */
  message?: string | null;
  onError?: (message: string) => void;
}

/**
 * Regel onder een PDF-knop: waar het bestand staat, met knoppen om het meteen
 * te openen of de map te tonen. Eén component voor alle views, zodat Audit,
 * Budget, Dashboard, Zoektermen en Rapport hetzelfde gedrag hebben.
 */
export default function PdfResult({ path, message, onError }: Props) {
  if (!path && !message) return null;
  const fail = (exception: unknown) => onError?.(String(exception));
  return (
    <div className="pdf-result">
      <span className="hint">{message ?? `Opgeslagen: ${path}`}</span>
      {path && (
        <>
          <button type="button" className="ghost" onClick={() => openPath(path).catch(fail)}>
            PDF openen
          </button>
          <button type="button" className="ghost" onClick={() => revealPath(path).catch(fail)}>
            Map openen
          </button>
        </>
      )}
    </div>
  );
}
