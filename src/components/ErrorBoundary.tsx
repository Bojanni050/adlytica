import React from "react";

interface State {
  error: Error | null;
}

/**
 * Vangt fouten in de render af. Zonder deze grens haalt React de hele boom
 * weg en blijft er een wit venster over, zonder enige aanwijzing.
 */
export default class ErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("Adlytica: onverwachte fout", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        style={{
          minHeight: "100vh",
          padding: "48px 32px",
          background: "#0d1117",
          color: "#e6edf3",
          fontFamily: "Inter, system-ui, sans-serif",
        }}
      >
        <div style={{ maxWidth: 820, margin: "0 auto" }}>
          <div style={{ color: "#f59e0b", fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase" }}>
            Adlytica
          </div>
          <h1 style={{ fontSize: 22, margin: "8px 0 6px" }}>Er ging iets mis bij het tekenen van dit scherm</h1>
          <p style={{ color: "#8b98a8", marginTop: 0, fontSize: 13.5 }}>
            De rest van de app is gestopt met tekenen om te voorkomen dat er iets onjuist wordt opgeslagen. Herladen
            lost het meestal op; blijft het terugkomen, stuur dan de melding hieronder door.
          </p>
          <pre
            style={{
              background: "#151b23",
              border: "1px solid #273140",
              borderRadius: 10,
              padding: "14px 16px",
              fontSize: 12,
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              color: "#ffb4a8",
              marginTop: 16,
            }}
          >
            {error.name}: {error.message}
            {error.stack ? `\n\n${error.stack}` : ""}
          </pre>
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: "#f59e0b",
                color: "#1b1206",
                border: "none",
                borderRadius: 8,
                padding: "9px 16px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Herladen
            </button>
            <button
              onClick={() => this.setState({ error: null })}
              style={{
                background: "transparent",
                color: "#8b98a8",
                border: "1px solid #273140",
                borderRadius: 8,
                padding: "9px 16px",
                cursor: "pointer",
              }}
            >
              Opnieuw proberen
            </button>
          </div>
        </div>
      </div>
    );
  }
}
