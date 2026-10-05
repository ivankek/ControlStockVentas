import { FLEX_LOCALITIES, MATANZA_LOCALITIES, detectFlexZone, normalizePlace, type FlexDestination, type FlexSelection } from "./flex-zones";

// Owner-provided bonus table. These groups are independent of courier cost zones.
export const BONUS_PLACES = {
  cercana: ["Hurlingham", "Ituzaingó", "La Matanza Norte", "Morón", "Tres de Febrero"],
  media: ["CABA", "Merlo", "San Martín", "San Miguel"],
  lejana: ["Almirante Brown", "Avellaneda", "Berazategui", "Berisso", "Campana", "Cañuelas", "Del Viso", "Derqui", "Ensenada", "Escobar", "Esteban Echeverría", "Ezeiza", "Florencio Varela", "Garín", "General Rodríguez", "Guernica", "Ingeniero Maschwitz", "José C. Paz", "La Matanza Sur", "La Plata Centro", "La Plata Norte", "La Plata Oeste", "Lanús", "Lomas de Zamora", "Luján", "Malvinas Argentinas", "Marcos Paz", "Moreno", "Nordelta", "Pilar", "Quilmes", "San Fernando", "San Isidro", "San Vicente", "Tigre", "Vicente López", "Villa Rosa", "Zárate"],
} as const;
export type BonusZone = keyof typeof BONUS_PLACES;
export const BONUS_RATES: Record<BonusZone, number> = { cercana: 499000, media: 699000, lejana: 899000 };
export const BONUS_LABELS: Record<BonusZone, string> = { cercana: "Zona cercana", media: "Distancia media", lejana: "Zona lejana" };
const aliases: Record<string, string> = {
  "capital federal": "CABA", "ciudad autonoma de buenos aires": "CABA", "ciudad de buenos aires": "CABA",
  "general san martin": "San Martín", "jose paz": "José C. Paz", "jose c paz": "José C. Paz", "jose clemente paz": "José C. Paz",
  "la plata": "La Plata Centro", "presidente derqui": "Derqui",
};
function placeZone(value?: string): BonusZone | undefined {
  const raw = normalizePlace(value).split(" barrio ")[0];
  const place = normalizePlace(aliases[raw] ?? raw);
  for (const zone of Object.keys(BONUS_PLACES) as BonusZone[]) if (BONUS_PLACES[zone].some((name) => normalizePlace(name) === place)) return zone;
  const matches = new Set<BonusZone>();
  for (const [district, localities] of Object.entries(FLEX_LOCALITIES)) {
    if (localities.some((name) => normalizePlace(name) === place)) {
      const zone = placeZone(district); if (zone) matches.add(zone);
    }
  }
  return matches.size === 1 ? [...matches][0] : undefined;
}
export function bonusZone(destination: FlexDestination, logisticsZone?: FlexSelection): { zone?: BonusZone; reason: string } {
  const province = normalizePlace(destination.province);
  if (["caba", "capital federal", "ciudad autonoma de buenos aires", "ciudad de buenos aires"].includes(province)) return { zone: "media", reason: "CABA" };
  if (province && !["buenos aires", "provincia de buenos aires", "gba", "gran buenos aires"].includes(province)) return { reason: "Destino fuera de las zonas de bonificación configuradas" };
  const municipality = destination.georef?.municipality ?? destination.municipality;
  if (municipality && normalizePlace(municipality) !== "la matanza") {
    const zone = placeZone(municipality);
    if (zone) return { zone, reason: municipality };
  }
  if (!province && !municipality) return { reason: "Falta provincia o municipio para calcular la bonificación" };
  const candidates = [destination.georef?.locality, destination.city, destination.neighborhood];
  // Owner confirmed the same north/south split used for courier costs.
  const matanzaNames = Object.values(MATANZA_LOCALITIES).flat().map(normalizePlace);
  const isMatanza = normalizePlace(municipality) === "la matanza" || candidates.some((value) => ["la matanza", "la matanza norte", "la matanza sur", ...matanzaNames].includes(normalizePlace(value)));
  if (isMatanza) {
    const logistics = logisticsZone ?? detectFlexZone(destination).zone;
    if (logistics === "CORDON_1") return { zone: "cercana", reason: "La Matanza Norte · misma zona que logística" };
    if (logistics === "CORDON_2") return { zone: "lejana", reason: "La Matanza Sur · misma zona que logística" };
    const sector = candidates.find((value) => ["la matanza norte", "la matanza sur"].includes(normalizePlace(value)));
    return sector ? { zone: placeZone(sector), reason: sector } : { reason: "La Matanza: falta identificar el sector Norte o Sur de la bonificación" };
  }
  const matches = candidates.map((place) => ({ zone: placeZone(place), place })).filter((entry) => entry.zone);
  const zones = new Set(matches.map((entry) => entry.zone));
  return zones.size === 1 ? { zone: matches[0].zone, reason: matches[0].place! } : { reason: zones.size ? "Destino contradictorio para la bonificación" : "Destino sin zona de bonificación reconocida" };
}
export function zoneBonus(destination: FlexDestination, grossCents?: number, logisticsZone?: FlexSelection) {
  const detection = bonusZone(destination, logisticsZone);
  if (!detection.zone) return { ...detection, cents: undefined, reduced: false };
  if (grossCents === undefined || !Number.isSafeInteger(grossCents) || grossCents < 0) return { ...detection, cents: undefined, reduced: false, reason: "Falta el bruto para calcular la bonificación" };
  const reduced = grossCents >= 3300000;
  return { ...detection, reduced, cents: BONUS_RATES[detection.zone] / (reduced ? 10 : 1) };
}
