import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Last-resort guard so a render error surfaces a readable message instead of a
 * blank window (an unmounted React root just shows the body background).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Keeper render error:", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            padding: 24,
            textAlign: "center",
            background: "var(--background-page)",
            color: "var(--foreground-primary)",
          }}
        >
          <div style={{ fontSize: 15 }}>Something went wrong rendering the app.</div>
          <div style={{ maxWidth: 560, color: "var(--foreground-muted)", fontSize: 12, overflowWrap: "break-word" }}>
            {this.state.error.message}
          </div>
          <button className="ui-btn ui-btn--primary ui-btn--md" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
