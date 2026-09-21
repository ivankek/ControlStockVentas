// Server-side enrichment only. Never forward ML credentials or buyer identities.
import { detectFlexZone, normalizePlace, type FlexDetection, type FlexDestination } from "./flex-zones";
import { shipmentDestination, type Shipment } from "./shipping";

type Place = { id?: string; nombre?: string };
type Location = { provincia?: Place; departamento?: Place; gobierno_local?: Place; localidad?: Place; nombre?: string; calle?: Place; altura?: { valor?: number } };
const base = "https://apis.datos.gob.ar/georef/api/v2.0/";
const same = (a?: string, b?: string) => !!a && !!b && normalizePlace(a) === normalizePlace(b);

function classify(row: Location, dest: FlexDestination, method: FlexDetection["method"]): FlexDetection | undefined {
  if (!row.provincia?.nombre || !row.departamento?.nombre) return;
  const municipality = row.departamento.nombre;
  const genericMatanza = same(dest.city, "La Matanza");
  const result = detectFlexZone({ province: row.provincia.nombre, municipality,
    city: row.localidad?.nombre ?? row.nombre ?? (genericMatanza ? dest.neighborhood : dest.city), neighborhood: dest.neighborhood });
  return { ...result, method, reason: `Georef: ${municipality}${row.localidad?.nombre || row.nombre ? ` · ${row.localidad?.nombre ?? row.nombre}` : ""}. ${result.reason}` };
}

// Request-scoped memoization: private addresses never enter a persistent cache.
// A service failure opens the circuit for this request; sales remain available.
export function createGeorefResolver(fetcher: typeof fetch = fetch) {
  const memo = new Map<string, Promise<FlexDetection | undefined>>();
  let unavailable = false;
  return async (shipment: Shipment): Promise<FlexDetection | undefined> => {
    if (shipment.logistic_type !== "self_service") return;
    const dest = shipmentDestination(shipment);
    const direct = detectFlexZone(dest);
    if (direct.zone && (direct.method === "province" || direct.method === "municipality" || (same(dest.municipality, "La Matanza") && direct.method === "locality"))) return;
    const address = shipment.destination?.shipping_address ?? shipment.receiver_address;
    const key = JSON.stringify([dest, address?.address_line, address?.street_name, address?.street_number]);
    if (memo.has(key)) return memo.get(key)!;
    const pending = (async (): Promise<FlexDetection | undefined> => {
      if (unavailable) return;
      let geographic: FlexDetection | undefined;
      let coordinateDistrict: string | undefined;
      const signal = AbortSignal.timeout(3000);
      const query = async (endpoint: string, params: Record<string, string>) => {
        const response = await fetcher(`${base}${endpoint}?${new URLSearchParams({ ...params, campos: "completo" })}`, { cache: "no-store", signal });
        if (!response.ok) throw Error("Georef unavailable");
        return response.json();
      };
      try {
        if (dest.latitude !== undefined && dest.longitude !== undefined) {
          const data = await query("ubicacion", { lat: String(dest.latitude), lon: String(dest.longitude) });
          const resolved = classify(data.ubicacion ?? {}, dest, "georef-coordinates");
          if (resolved?.zone || (resolved && !same(data.ubicacion?.departamento?.nombre, "La Matanza"))) return resolved;
          geographic = resolved;
          coordinateDistrict = data.ubicacion?.departamento?.nombre;
        }
        // Scope text searches to a known province; names alone are not geographic evidence.
        const province = same(dest.province, "Buenos Aires") || same(dest.province, "Provincia de Buenos Aires") ? "06" : undefined;
        // ML sometimes sends the partido as city and the actual locality as neighborhood.
        const city = same(dest.city, "La Matanza") && dest.neighborhood ? dest.neighborhood : dest.city || dest.neighborhood;
        if (!province || !city) return geographic;
        const line = address?.address_line?.trim() ?? "";
        const parsed = line.match(/^(.*?)\s+(\d+)$/);
        const street = address?.street_name?.trim() || parsed?.[1]?.trim();
        const height = String(address?.street_number ?? parsed?.[2] ?? "").trim();
        if (street && /^\d+$/.test(height)) {
          const data = await query("direcciones", { direccion: `${street} ${height}`, provincia: province, localidad: city, max: "100" });
          const rows: Location[] = Array.isArray(data.direcciones) ? data.direcciones : [];
          const exact = rows.filter(row => same(row.calle?.nombre, street) && Number(row.altura?.valor) === Number(height) && same(row.localidad?.nombre, city) && row.provincia?.id === province && (!coordinateDistrict || same(row.departamento?.nombre, coordinateDistrict)));
          if (exact.length === 1) {
            const resolved = classify(exact[0], dest, "georef-address");
            if (resolved) return resolved;
          }
          if (exact.length > 1) return { method: "georef-address", reason: "Georef: dirección ambigua; seleccionar zona manualmente" };
        }
        if (geographic) return geographic;
        const data = await query("localidades", { nombre: city, provincia: province, max: "100" });
        const rows: Location[] = Array.isArray(data.localidades) ? data.localidades : [];
        const exact = rows.filter(row => same(row.nombre, city) && row.provincia?.id === province);
        if (data.total > rows.length || exact.length > 1) return { method: "georef-locality", reason: "Georef: localidad ambigua; falta dirección o municipio verificable" };
        if (exact.length === 1) return classify(exact[0], dest, "georef-locality");
      } catch { unavailable = true; }
      // Unavailable or no exact result: preserve the existing conservative aliases.
      return geographic;
    })();
    memo.set(key, pending);
    return pending;
  };
}
