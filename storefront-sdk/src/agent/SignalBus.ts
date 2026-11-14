import type { Signal, SignalName } from "./types";
export class SignalBus {
  private listeners = new Map<
    SignalName | "*",
    Set<(signal: Signal) => void>
  >();
  constructor(private onError: () => void = () => {}) {}
  on(name: SignalName | "*", listener: (signal: Signal) => void): () => void {
    const listeners = this.listeners.get(name) || new Set();
    listeners.add(listener);
    this.listeners.set(name, listeners);
    return () => {
      listeners.delete(listener);
    };
  }
  publish(name: SignalName, data: Record<string, unknown> = {}): void {
    const signal: Signal = Object.freeze({
      name,
      data: Object.freeze({ ...data }),
      ts: Date.now(),
    });
    for (const listener of [
      ...(this.listeners.get(name) || []),
      ...(this.listeners.get("*") || []),
    ]) {
      try {
        listener(signal);
      } catch {
        this.onError();
      }
    }
  }
  destroy(): void {
    this.listeners.clear();
  }
}
