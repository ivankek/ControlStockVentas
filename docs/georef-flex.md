# Detección Flex con Georef

`lib/georef.ts` enriquece envíos Flex en el servidor desde `lib/meli.ts` (Despachos) y `lib/meli-profit.ts` (Ganancias). No persiste ventas ni direcciones. La selección manual conserva prioridad en `detectFlexZone`.

1. Un municipio de Mercado Libre que permite clasificar evita consultas adicionales. La Matanza es una excepción porque el partido solo no determina el sector.
2. Si no alcanza, coordenadas válidas: `/ubicacion` identifica el departamento (partido en Buenos Aires), antes de interpretar nombres de localidades. También se aceptan coordenadas numéricas representadas como texto.
3. Dirección: `/direcciones`, con calle, altura, localidad y provincia. Se exige coincidencia normalizada exacta de calle, altura y localidad, y un único candidato.
4. Sin dirección resoluble: `/localidades` permite identificar el partido de una localidad exacta y única en Buenos Aires. Los resultados ambiguos no se resuelven eligiendo el primero, incluso si comparten tarifa.
5. Si el servicio falla o no devuelve coincidencias exactas, se conservan los mecanismos locales existentes. En La Matanza se requieren coordenadas confirmadas dentro del partido o una localidad clasificada.

Para La Matanza, una coordenada que Georef confirme dentro del partido se compara con los centroides oficiales de sus localidades. La localidad clasificada más cercana determina el sector Flex según las listas suministradas por el negocio. De este modo las coordenadas resuelven el cordón aunque el envío no incluya el nombre de la localidad. Sin coordenadas se conserva la clasificación textual y, si tampoco alcanza, la selección manual.

Las tarifas y los aliases siguen centralizados en `lib/flex-zones.ts`; las tarifas guardadas por fecha siguen aplicándose en `lib/business.ts`. Georef aporta geografía, no tarifas de transporte. El CP permanece como apoyo del mecanismo local; Georef no recibe un filtro postal inventado.

Cada solicitud tiene un límite de 1,5 segundos. Los destinos repetidos comparten promesa dentro de la consulta. Un fallo de georreferenciación inversa permite continuar con dirección, localidad y reglas locales; tampoco desactiva Georef para los siguientes envíos. No hay caché persistente de domicilios. Se usa HTTPS, `cache: no-store`, sin credenciales de Mercado Libre ni nombres de compradores. No requiere variables de entorno ni migraciones. Tras desplegar, volver a consultar las ventas para obtener el enriquecimiento.

Referencia oficial: https://www.argentina.gob.ar/georef/referencia-completa-de-la-api

Pruebas: `tests/georef.test.ts` cubre coincidencias, ambigüedad, coordenadas, La Matanza, prioridad manual, fallos y deduplicación. Se verificó además la dirección de ejemplo Guaminí 5945, Wilde contra el servicio real: Avellaneda, Cordón 1.
