import { Component, type ReactNode } from "react";

/**
 * Catches failures from loading/auto-rigging a GLB (corrupt file, no
 * recognizable skeleton, ...) so a bad import can't take down the app.
 * The parent shows the message and switches back to a working model.
 */
export class ModelErrorBoundary extends Component<
  { onError: (message: string) => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(err: unknown) {
    this.props.onError(err instanceof Error ? err.message : String(err));
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
