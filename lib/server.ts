import { createClient } from "@supabase/supabase-js";
import { emptyState, State } from "./domain";
export function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Configuración pendiente: ${name}.`);
  return value;
}
export function admin() {
  return createClient(
    required("NEXT_PUBLIC_SUPABASE_URL"),
    required("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
export async function owner(request: Request) {
  const bearer = request.headers.get("authorization");
  if (!bearer?.startsWith("Bearer "))
    throw Error("Iniciá sesión para continuar.");
  const db = admin();
  const { data, error } = await db.auth.getUser(bearer.slice(7));
  if (error || !data.user) throw Error("La sesión venció. Volvé a ingresar.");
  return data.user.id;
}
export async function readState(userId: string) {
  const db = admin();
  const { data, error } = await db
    .from("account_states")
    .select("state,version")
    .eq("owner_id", userId)
    .maybeSingle();
  if (error)
    throw Error(
      "No se pudo leer la base de datos. Revisá que la migración esté aplicada.",
    );
  return data
    ? { state: data.state as State, version: data.version as number }
    : { state: emptyState(), version: 0 };
}
export async function mutate(userId: string, fn: (s: State) => State) {
  for (let i = 0; i < 3; i++) {
    const { state, version } = await readState(userId);
    const next = fn(state);
    if (next === state) return state;
    const { data, error } = await admin().rpc("save_account_state", {
      p_owner: userId,
      p_expected: version,
      p_state: next,
    });
    if (error) throw Error("No se pudieron guardar los cambios.");
    if (data === true) return next;
  }
  throw Error("Hubo otro cambio simultáneo. Actualizá e intentá de nuevo.");
}
export function fail(error: unknown) {
  const msg =
    error instanceof Error
      ? error.message
      : "No se pudo completar la operación.";
  const status = /sesión/.test(msg) ? 401 : 400;
  return Response.json(
    { error: msg },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
