import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  title?: string;
  onReset?: () => void;
}

interface State {
  error: Error | null;
}

export class PanelErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[PanelErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          className="rounded-lg p-4 shadow-2xl font-ui text-xs space-y-2"
          style={{
            width: 360,
            background: 'var(--color-bg-secondary)',
            border: '1px solid var(--color-border)',
          }}
        >
          <p className="font-display text-sm" style={{ color: 'var(--color-accent-red-hot)' }}>
            {this.props.title ?? 'Panel failed to load'}
          </p>
          <p style={{ color: 'var(--color-text-secondary)' }}>
            {this.state.error.message || 'Something went wrong rendering this panel.'}
          </p>
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={() => {
              this.setState({ error: null });
              this.props.onReset?.();
            }}
          >
            Dismiss
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
