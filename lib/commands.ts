import { z } from "zod";
import { confirmDispatch, settle, State } from "./domain";
export const dateSchema = z.iso.date();
export const commandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("confirm"),
    id: z.string().min(1),
    date: dateSchema,
  }),
  z.object({
    type: z.literal("cost"),
    id: z.string().min(1),
    date: dateSchema,
    cents: z.number().int().positive().max(100000000000),
  }),
  z.object({ type: z.literal("pay"), date: dateSchema }),
]);
export type Command = z.infer<typeof commandSchema>;
export function applyCommand(state: State, raw: unknown): State {
  const action = commandSchema.parse(raw);
  const next = structuredClone(state);
  if (action.type === "confirm") confirmDispatch(next, action.id, action.date);
  if (action.type === "pay") settle(next, action.date);
  if (action.type === "cost") {
    const p = next.products.find((p) => p.id === action.id);
    if (!p) throw Error("Producto inexistente.");
    p.costs = p.costs.filter((c) => c.from !== action.date);
    p.costs.push({ from: action.date, cents: action.cents });
    p.costs.sort((a, b) => a.from.localeCompare(b.from));
  }
  return next;
}
