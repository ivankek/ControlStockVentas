// Keep diagnostics limited to the HTTP status and a machine error code: upstream
// response bodies may contain personal data and must not be sent to the browser.
export async function readReturnResource(path: string, token: string): Promise<unknown> {
  const resource = path.includes("/search?") ? "búsqueda de reclamos" : path.endsWith("/history") ? "historial del envío de devolución" : path.endsWith("/returns") ? "detalle de devolución" : "detalle del reclamo";
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(`https://api.mercadolibre.com${path}`, { headers: { Authorization: `Bearer ${token}`, "x-format-new": "true" }, cache: "no-store", signal: AbortSignal.timeout(30000) });
    if (response.ok && response.status !== 206) return response.json();
    if ([429, 500, 502, 503, 504].includes(response.status) && attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1))); continue;
    }
    const body = await response.json().catch(() => null);
    // Some responses use code: 400 and error: "invalid_query". A numeric code
    // must not hide the useful machine-readable error alongside it.
    const candidate = [body?.code, body?.error, body?.error?.code, body?.cause?.code].find((value) => typeof value === "string" && /^[A-Za-z0-9_.-]{1,100}$/.test(value));
    const code = candidate ? ` Código: ${candidate}.` : "";
    const explanation = response.status === 403
      ? "Mercado Libre rechazó el acceso. Revisá los permisos funcionales de la aplicación para reclamos y devoluciones; si ya están habilitados, hace falta revisar la autorización de la cuenta."
      : response.status === 401 ? "La autorización venció. Volvé a conectar la cuenta." : response.status === 400 ? "Mercado Libre rechazó los parámetros de la consulta." : "Mercado Libre no pudo completar la consulta.";
    throw Object.assign(Error(`${explanation} Recurso: ${resource} (${response.status}).${code}`), { status: response.status === 403 ? 403 : 502 });
  }
  throw Error("No se pudo consultar Mercado Libre.");
}
