"use client";
import { createContext, useContext } from "react";
import type { InventorySnapshot } from "@/lib/inventory";
export const InventoryContext = createContext<{
  data?: InventorySnapshot; account: string; setAccount: (id: string) => void;
  command: (action?: unknown) => Promise<void>;
}>({ account: "", setAccount: () => {}, command: async () => {} });
export function useInventory() { return useContext(InventoryContext); }
export function useAccountPath() {
  const { account } = useInventory();
  return (path: string) => account ? `${path}?account=${encodeURIComponent(account)}` : path;
}
