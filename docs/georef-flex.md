# Detección Flex con Georef

`lib/georef.ts` enriquece envíos Flex en el servidor desde `lib/meli.ts` (Despachos) y `lib/meli-profit.ts` (Ganancias). No persiste ventas ni direcciones. La selección manual conserva prioridad en `detectFlexZone`.

1. Un municipio de Mercado Libre que permite clasificar evita consultas adicionales.
2. Coordenadas: `/ubicacion` identifica el departamento (partido en Buenos Aires).
3. Dirección: `/direcciones`, con calle, altura, localidad y provincia. Se exige coincidencia normalizada exacta de calle, altura y localidad, y un único candidato.
4. Sin dirección resoluble: `/localidades` permite identificar el partido de una localidad exacta y única en Buenos Aires. Los resultados ambiguos no se resuelven eligiendo el primero, incluso si comparten tarifa.
5. Si el servicio falla o no devuelve coincidencias exactas, se conservan los mecanismos locales existentes. La Matanza siempre requiere una localidad clasificada; un resultado geográfico conocido no se reemplaza por una suposición.

Las tarifas y los aliases siguen centralizados en `lib/flex-zones.ts`; las tarifas guardadas por fecha siguen aplicándose en `lib/business.ts`. Georef aporta geografía, no tarifas de transporte. El CP permanece como apoyo del mecanismo local; Georef no recibe un filtro postal inventado.

Cada resolución tiene un límite compartido de 3 segundos. Los destinos repetidos comparten promesa dentro de la consulta; después de un fallo no se inician más solicitudes a Georef en esa consulta. No hay caché persistente de domicilios. Se usa HTTPS, `cache: no-store`, sin credenciales de Mercado Libre ni nombres de compradores. No requiere variables de entorno ni migraciones. Tras desplegar, volver a consultar las ventas para obtener el enriquecimiento.

Referencia oficial: https://www.argentina.gob.ar/georef/referencia-completa-de-la-api

Pruebas: `tests/georef.test.ts` cubre coincidencias, ambigüedad, coordenadas, La Matanza, prioridad manual, fallos y deduplicación. Se verificó además la dirección de ejemplo Guaminí 5945, Wilde contra el servicio real: Avellaneda, Cordón 1.
