import { Component, type ReactNode } from "react";
import { Button } from "./ui/button";

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error("[nordhunt] render error", error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    const chunk = /dynamically imported module|Loading chunk/i.test(this.state.error.message);
    return (
      <div className="mx-auto mt-24 max-w-md px-6 text-center">
        <h1 className="font-display text-xl font-bold">{chunk ? "A new version is available" : "Something went wrong"}</h1>
        <p className="mt-2 text-sm text-muted">{chunk ? "Reload to get the latest NORDHUNT." : this.state.error.message}</p>
        <Button className="mt-6" onClick={() => location.reload()}>Reload</Button>
      </div>
    );
  }
}
