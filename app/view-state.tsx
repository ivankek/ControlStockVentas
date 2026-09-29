"use client";
import { createContext, useCallback, useContext, useRef, useState, useSyncExternalStore, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { ViewStore } from "@/lib/view-store";
import { useInventory } from "./inventory-context";

const Views = createContext<ViewStore | null>(null);
export function ViewStateProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => new ViewStore());
  return <Views.Provider value={store}>{children}</Views.Provider>;
}
export function useViewState<T>(name: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>];
export function useViewState<T = undefined>(name: string): [T | undefined, Dispatch<SetStateAction<T | undefined>>];
export function useViewState<T>(name: string, initial?: T | (() => T)) {
  const store = useContext(Views);
  const { account } = useInventory();
  if (!store) throw Error("Falta el almacén de consultas de la sesión.");
  const [fallback] = useState(initial);
  const key = JSON.stringify([account, name]);
  const fallbackRef = useRef(fallback);
  const get = useCallback(() => store.read(key, fallbackRef.current), [store, key]);
  const value = useSyncExternalStore(store.subscribe, get, get);
  const set = useCallback((next: SetStateAction<T | undefined>) => {
    store.write(key, typeof next === "function" ? (next as (old: T | undefined) => T | undefined)(get()) : next);
  }, [store, key, get]);
  return [value, set];
}
