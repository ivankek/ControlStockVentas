// Operational approximation of the map supplied by the owner, not official ML zones.
export const FLEX_ZONES = ["CABA", "CORDON_1", "CORDON_2", "CORDON_3"] as const;
export type FlexZone = typeof FLEX_ZONES[number];
export type FlexSelection = FlexZone | "NONE";
export const FLEX_LABELS: Record<FlexSelection, string> = { CABA: "CABA", CORDON_1: "Cordón 1", CORDON_2: "Cordón 2", CORDON_3: "Cordón 3", NONE: "Sin Flex" };
export const FLEX_RATES: Record<FlexZone, number> = { CABA: 320000, CORDON_1: 364000, CORDON_2: 420000, CORDON_3: 600000 };
export const normalizePlace = (value = "") => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[.]/g, "").replace(/[^a-z0-9]+/g, " ").trim().replace(/^(partido|municipalidad|municipio) de /, "");
export const FLEX_DISTRICTS: Record<Exclude<FlexZone, "CABA">, string[]> = {
  CORDON_1: ["Vicente López", "General San Martín", "San Martín", "Tres de Febrero", "Avellaneda", "Lanús", "Lomas de Zamora"],
  CORDON_2: ["San Isidro", "San Fernando", "Tigre", "Malvinas Argentinas", "José C. Paz", "José Clemente Paz", "San Miguel", "Hurlingham", "Ituzaingó", "Morón", "Moreno", "Merlo", "Pilar", "Escobar", "Quilmes", "Berazategui", "Florencio Varela", "Almirante Brown", "Esteban Echeverría", "Ezeiza", "Presidente Perón"],
  CORDON_3: ["Zárate", "Campana", "Exaltación de la Cruz", "Luján", "General Rodríguez", "Marcos Paz", "General Las Heras", "Cañuelas", "San Vicente", "La Plata", "Ensenada", "Berisso"],
};
// Locality split is deliberately explicit: unknown La Matanza localities never inherit a district default.
export const MATANZA_LOCALITIES: Record<"CORDON_1" | "CORDON_2", string[]> = {
  CORDON_1: ["San Justo", "Ramos Mejía", "Villa Luzuriaga", "Lomas del Mirador", "La Tablada", "Tapiales", "Ciudad Madero", "Villa Madero", "Villa Eduardo Madero", "Villa Celina", "Aldo Bonzi", "Ciudad Evita"],
  CORDON_2: ["Isidro Casanova", "Rafael Castillo", "Gregorio de Laferrere", "Laferrere", "González Catán", "Virrey del Pino", "20 de Junio", "Veinte de Junio"],
};
export const FLEX_LOCALITIES: Record<string, string[]> = {
  "Avellaneda": ["Sarandí"],
  "Pilar": ["Presidente Derqui", "Villa Rosa"],
  "Quilmes": ["Bernal Oeste"],
  "Berazategui": ["Juan María Gutiérrez"],
  "Hurlingham": ["Villa Tesei"],
  "Lomas de Zamora": ["Banfield", "Banfield Oeste", "Banfield Este", "Temperley", "Llavallol", "Turdera", "Villa Centenario", "Villa Fiorito", "Ingeniero Budge"],
  "Morón": ["Haedo", "El Palomar", "Castelar"],
  "Moreno": ["Paso del Rey"],
  "Merlo": [ "San Antonio de Padua", "Libertad", "Mariano Acosta", "Pontevedra"],
  "Almirante Brown": ["Adrogué", "Burzaco", "Longchamps", "Glew", "Rafael Calzada", "Claypole"],
  "Tres de Febrero": ["Caseros", "Ciudadela", "Santos Lugares", "Villa Bosch", "Martín Coronado", "Loma Hermosa", "Pablo Podestá", "José Ingenieros", "Churruca"],
  "Esteban Echeverría": ["Monte Grande", "Luis Guillón", "9 de Abril", "Canning"],
  "Tigre": ["General Pacheco", "El Talar", "Don Torcuato", "Benavídez", "Rincón de Milberg"],
  "Escobar": ["Belén de Escobar", "Garín", "Ingeniero Maschwitz", "Matheu", "Maquinista Savio"],
  "Vicente López": ["Olivos", "Florida", "Florida Oeste", "Munro", "Carapachay", "Villa Martelli", "La Lucila"],
};
// Postal codes alone may cover several localities. Only explicitly verified entries belong here.
export const FLEX_POSTAL_LOCALITIES: Record<string, string> = { "1753": "Villa Luzuriaga" };
export type FlexDestination = { province?: string; municipality?: string; city?: string; neighborhood?: string; postalCode?: string; latitude?: number; longitude?: number };
export type FlexDetection = { zone?: FlexSelection; method: "manual" | "province" | "municipality" | "locality" | "postal" | "unknown"; reason: string };
const includes = (names: string[], value?: string) => !!value && names.some((name) => normalizePlace(name) === normalizePlace(value));
const caba = (value?: string) => includes(["CABA", "Capital Federal", "Ciudad Autónoma de Buenos Aires", "Ciudad de Buenos Aires"], value);
const districtZone = (value?: string): FlexZone | undefined => FLEX_ZONES.find((zone) => zone !== "CABA" && includes(FLEX_DISTRICTS[zone], value));
const matanzaZone = (value?: string): FlexZone | undefined => (["CORDON_1", "CORDON_2"] as const).find((zone) => includes(MATANZA_LOCALITIES[zone], value));
export function detectFlexZone(destination: FlexDestination, manual?: FlexSelection): FlexDetection {
  if (manual) return { zone: manual, method: "manual", reason: "Selección manual" };
  const unknown = (reason: string): FlexDetection => ({ method: "unknown", reason });
  if (caba(destination.province)) return { zone: "CABA", method: "province", reason: "Provincia: CABA / Capital Federal" };
  // Never classify names shared with other provinces as AMBA.
  if (destination.province && !includes(["Buenos Aires", "Provincia de Buenos Aires", "GBA", "Gran Buenos Aires"], destination.province)) return unknown("Destino fuera de AMBA o provincia no reconocida");
  const municipality = normalizePlace(destination.municipality) ? destination.municipality : undefined;
  if (caba(municipality)) return { zone: "CABA", method: "municipality", reason: "Municipio identificado como CABA" };
  // A real municipality takes precedence over locality names, including ambiguous ones.
  if (municipality && !includes(["La Matanza"], municipality)) {
    const zone = districtZone(municipality);
    return zone ? { zone, method: "municipality", reason: `Municipio: ${municipality} · clasificación aproximada` } : unknown(`Municipio no clasificado: ${municipality}`);
  }
  if (!municipality && caba(destination.city)) return { zone: "CABA", method: "locality", reason: "Destino identificado como CABA" };
  const isMatanza = includes(["La Matanza"], municipality) || includes(["La Matanza"], destination.city);
  if (isMatanza) {
    const zones = new Set([matanzaZone(destination.city), matanzaZone(destination.neighborhood)].filter(Boolean));
    if (zones.size === 1) return { zone: [...zones][0], method: "locality", reason: "Localidad de La Matanza · clasificación aproximada" };
    if (zones.size > 1) return unknown("Localidad y barrio de La Matanza contradictorios");
    // A postal fallback is allowed only when no specific locality was supplied.
    if (!destination.city || includes(["La Matanza"], destination.city)) {
      const code = destination.postalCode?.toUpperCase().replace(/\s/g, "").match(/^(?:B)?(\d{4})(?:[A-Z]{3})?$/)?.[1];
      const zone = code ? matanzaZone(FLEX_POSTAL_LOCALITIES[code]) : undefined;
      if (zone) return { zone, method: "postal", reason: "Código postal conocido de La Matanza" };
    }
    return unknown("La Matanza: falta una localidad clasificada");
  }
  // Missing province is too weak for locality-only matches (e.g. San Martín).
  if (!destination.province) return unknown("Falta provincia o municipio para ubicar el destino");
  if ([destination.city, destination.neighborhood].some((place) => includes(["San Francisco Solano", "Solano"], place))) return unknown("San Francisco Solano: falta municipio o ubicación geográfica verificable");
  const zones = new Set<FlexZone>();
  const districts = new Set<string>();
  for (const place of [destination.city, destination.neighborhood]) {
    const zone = districtZone(place) ?? matanzaZone(place);
    if (zone) zones.add(zone);
    for (const [district, names] of Object.entries(FLEX_LOCALITIES)) if (includes(names, place)) { zones.add(districtZone(district)!); districts.add(district); }
  }
  return zones.size === 1 ? { zone: [...zones][0], method: "locality", reason: `Localidad / barrio reconocido${districts.size ? ` → ${[...districts].join(" / ")}` : ""} · clasificación aproximada` } : unknown(zones.size ? "Datos de destino contradictorios" : "Destino sin clasificación confiable");
}
