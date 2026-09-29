// One instance per signed-in session; never a process-global or persistent cache.
export class ViewStore {
  private values = new Map<string, unknown>();
  private listeners = new Set<() => void>();
  read<T>(key: string, fallback: T): T { return this.values.has(key) ? this.values.get(key) as T : fallback; }
  write<T>(key: string, value: T) {
    this.values.set(key, value);
    for (const notify of this.listeners) notify();
  }
  subscribe = (notify: () => void) => { this.listeners.add(notify); return () => { this.listeners.delete(notify); }; };
}
