# Costos de logística Flex

`lib/flex-zones.ts` contiene las tarifas base en centavos, los partidos, los alias y la división de localidades de La Matanza. Es una clasificación operativa aproximada del mapa del proveedor; no son las zonas de cobro de Mercado Libre. Revisar estas listas con la logística antes de usarlas como liquidación definitiva. Villa Luzuriaga en Cordón 1 está confirmada por el usuario.

La dirección proviene exclusivamente del destino de `/shipments`, tanto del formato nuevo como del anterior. No se usa la dirección de facturación. Se transportan provincia, municipio, localidad, barrio, CP y coordenadas cuando están disponibles. Referencia: https://developers.mercadolibre.com.ar/es_ar/autenticacion-y-autorizacion/envios

Prioridad: elección manual; identificación de CABA/provincia; municipio (con localidad obligatoria para La Matanza); localidades y alias conocidos. El CP 1753 solo apoya La Matanza cuando falta la localidad, no reemplaza una localidad desconocida explícita. Se normalizan mayúsculas, tildes, puntuación y espacios; no se hacen coincidencias parciales o difusas que puedan confundir destinos. Fuera de Buenos Aires/CABA o con evidencia contradictoria se devuelve desconocido.

Las coordenadas se conservan pero no se clasifican todavía: el mapa de referencia es una imagen sin polígonos georreferenciados verificables. No se inventan límites con rectángulos ni se envían direcciones a servicios externos. Una ampliación puede incorporar polígonos validados antes de las reglas de texto.

Tarifas base: CABA 3200, Cordón 1 3640, Cordón 2 4200 y Cordón 3 6000 pesos. En Gastos del negocio se pueden guardar nuevas tarifas con fecha de vigencia. Se usa la fecha de creación de la venta, igual que los otros costos del reporte. Para fechas sin tarifa guardada se usa la base actual y se indica que es una estimación; no representa un precio histórico verificado. Las antiguas zonas personalizadas se conservan por compatibilidad pero no intervienen en esta clasificación.

Persistencia: `business.flexRates` y `business.notes[orderId].flexZone` en el estado JSON existente. No requiere migración SQL ni guarda ventas. Se mantienen la verificación de propiedad de la orden, la asociación a cuenta y el control de concurrencia de `/api/business`. Automático elimina el override; Sin Flex aplica cero de logística propia sin cambiar el tipo real de envío.

Ganancias y Despachos comparten resolución por shipment. Una elección manual en cualquiera de sus órdenes prevalece. Overrides contradictorios dejan el envío pendiente. Ganancias descuenta el costo una sola vez; si falta una zona, no calcula un neto ficticio. Correo sigue sin un segundo descuento y los envíos acordados mantienen su costo manual.

Pruebas: `tests/flex-zones.test.ts`, `tests/profit.test.ts` y `tests/dispatch-query.test.ts`.
