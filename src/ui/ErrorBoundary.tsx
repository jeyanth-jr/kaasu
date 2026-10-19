import { Component, type ReactNode } from "react";

/** Keeps one broken screen from blanking the app, and points at the backup. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-loss/30 bg-surface p-6 text-sm">
        <h2 className="display text-xl">This screen hit a problem</h2>
        <p className="mt-2 text-muted">Your data is safe in this browser. Try another tab, or reload. If it keeps happening, download a backup from Settings.</p>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-sunken p-2 text-xs text-muted">{this.state.error.message}</pre>
        <button className="mt-3 rounded-xl border border-line px-3 py-1.5" onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
