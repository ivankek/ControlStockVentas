# Productos del proveedor y stock único

La pantalla **Stock** reúne productos, SKU obligatorio, precio unitario con vigencia y una única cantidad de stock. Costos deja de ser una sección separada en la aplicación conectada.

- SUPPLIER crea y modifica solamente sus productos, precios y stock. No selecciona otro proveedor.
- USER consulta el catálogo de proveedores con relación activa y asocia sus propias publicaciones desde Publicaciones. No puede crear ni modificar productos, precios o stock.
- ADMIN administra todos los proveedores y sus relaciones con vendedores.

El precio y el stock de un producto se guardan en una transacción; el control de versión impide sobrescribir una edición concurrente. Los precios conservan fechas de vigencia. Cambiar stock registra un movimiento. El stock aún no se sincroniza automáticamente con Mercado Libre.

## Activación y reinicio del catálogo

Aplicar una sola vez `supabase/migrations/20260922120816_supplier_owned_single_stock.sql`, después de las migraciones 001 a 004, coordinado con el despliegue de esta versión. La versión anterior usa columnas retiradas por esta migración; evitar escrituras durante el cambio.

La migración realiza lo pedido para comenzar de cero:

1. Copia productos, precios, inventario, movimientos y asociaciones a `inventory_archive.catalog_before_single_stock`. Es una copia privada sin acceso para roles del navegador y sin credenciales de cuentas.
2. Vacía el catálogo, costos, movimientos y asociaciones anteriores, incluidas las referencias del estado JSON. No borra usuarios, relaciones proveedor–vendedor, cuentas, publicaciones ML, gastos ni cierres guardados.
3. Retira las columnas de reserva y cambia `physical_stock` por `stock`.
4. Actualiza las funciones de inventario y sus validaciones de permisos.

Después el proveedor debe cargar los productos y el vendedor debe volver a asociar sus publicaciones. Las consultas históricas de ganancias/despachos podrán indicar costos pendientes hasta que existan asociaciones y precios con la vigencia necesaria. Los cierres con importes ya guardados se conservan.

No volver a ejecutar este SQL para una actualización normal: incluye un reinicio intencional. La tabla de copia evita que una segunda ejecución elimine un catálogo ya reconstruido.

## Verificación

`npm test` incluye una prueba PostgreSQL embebida en una base temporal: aplica todas las migraciones, verifica la copia y el reinicio, conserva cuentas/relaciones, prueba permisos USER/SUPPLIER/ADMIN, asociaciones, historial de precios, conflictos de versión, rollback e idempotencia del ajuste. No utiliza la base de producción.
