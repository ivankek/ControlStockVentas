# Corrección de precios y ganancias — 29/09/2026

Ejecutar **una sola vez**, en el SQL Editor de Supabase, el archivo completo
`supabase/migrations/20260929034937_correct_supplier_price_dates.sql`.
No volver a ejecutar la migración anterior que reinicia el catálogo.

La corrección de datos cambia únicamente la fecha del precio vigente al 29/09/2026
de cada producto al 01/09/2026. Si hay varias vigencias consecutivas con el mismo
importe, mueve la primera de ese tramo y conserva las restantes; la edición muestra
esa fecha inicial. No cambia importes, stock, productos, asociaciones
ni otros precios. No borra ni fusiona registros, ni crea tablas de respaldo.
Si encuentra otra vigencia entre la fecha original y el 01/09, detiene toda la
transacción sin aplicar cambios: ese historial requiere revisión individual.
Los productos sin precio no reciben un importe inventado.

También corrige la función de edición: cambiar solo la fecha mueve el precio
existente. Una corrección que se cruza con otro importe del historial se rechaza
con una explicación. La pantalla muestra la fecha real del precio vigente.
Desplegar el código junto con esta migración; luego recargar y consultar los datos.

Las consultas, filtros y resultados se conservan en un almacén de React Context
en memoria, separado por cuenta. Se vacía al cerrar sesión, cambiar de usuario o
recargar la página. No guarda pedidos en localStorage ni en Supabase. Para obtener
ventas nuevas o actualizar una consulta guardada, usar su botón Consultar.

Los gastos mensuales están retirados de las pantallas, de los comandos de edición
y del neto del período. Sus datos históricos se conservan sin descontarlos.

Ganancias consulta los períodos de facturación reales del vendedor y los detalles
Flex, incluidas bonificaciones y anulaciones posteriores a la venta. Deduplica los
movimientos por ID y los vincula por envío y orden. Solo suma una bonificación al
recibido cuando el desglose del pago permite comprobar que falta; si ya está
incluida, no la repite. Un desglose ambiguo o un error de permisos de facturación
se muestra como pendiente, con la opción existente de completar el recibido total.
No se utilizan tarifas del transportista como si fueran bonificaciones de ML.
En Mercado Envíos correo se conserva el neto de MP, sin descontar el envío otra vez.

Fuentes de la integración:
- [Períodos de facturación](https://developers.mercadolibre.com.ar/reportes-de-facturacion)
- [Detalles de bonificaciones Flex y anulaciones](https://developers.mercadolibre.com.ar/es_ar/envio/provisiones)
- [Localidades de San Isidro](https://www.sanisidro.gob.ar/localidades)

La prueba automatizada de SQL usa una base PGlite descartable. Las pruebas de ML/MP
usan respuestas simuladas; no reemplazan la conciliación de una venta real después
del despliegue, especialmente si la cuenta no dispone de acceso a facturación.
