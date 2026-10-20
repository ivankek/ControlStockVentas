# Tiendanube y asociaciones por SKU

En Conexión, el vendedor pulsa Conectar Tiendanube y autoriza el acceso desde Tiendanube. El servidor intercambia el código, obtiene el ID de tienda y verifica el acceso al catálogo antes de guardar el token cifrado. El token no se devuelve al navegador. La API manual anterior sigue disponible para integraciones existentes.

## Configuración OAuth

Variables privadas en Vercel: `TIENDANUBE_CLIENT_ID`, `TIENDANUBE_CLIENT_SECRET`. También se usan `APP_URL`, `TOKEN_ENCRYPTION_KEY` y las variables de Supabase existentes. Aplicar las variables al entorno de producción y desplegar este código.

En Partners, configurar estos valores (para otro dominio, reemplazar el origen):

- Página: `https://control-stock-ventas-despachos.vercel.app`
- Redirección: `https://control-stock-ventas-despachos.vercel.app/api/tiendanube/callback`
- Store redact: `https://control-stock-ventas-despachos.vercel.app/api/tiendanube/privacy/store-redact`
- Customers redact: `https://control-stock-ventas-despachos.vercel.app/api/tiendanube/privacy/customers-redact`
- Customers data request: `https://control-stock-ventas-despachos.vercel.app/api/tiendanube/privacy/customers-data-request`

Iniciar la instalación desde Despachos, con sesión iniciada: el callback requiere una cookie cifrada y el mismo `state`, con vencimiento de diez minutos. Revalidar el perfil antes del intercambio. Una renovación conserva catálogo y asociaciones; la base impide apropiarse de tiendas de otro usuario. No usar el Client Secret como token de tienda.

Los webhooks verifican HMAC SHA256 del cuerpo original con el Client Secret. Store redact elimina la conexión, credenciales, catálogo y asociaciones de esa tienda; no elimina productos del proveedor. Los otros dos responden sin datos personales porque esta versión no guarda clientes ni pedidos de Tiendanube. El informe vacío se devuelve en la respuesta HTTP; no se envía por email. Al agregar ventas se deberán ampliar estos handlers para borrar/exportar los nuevos datos.

Publicaciones muestra una sección por plataforma conectada. Actualizar publicaciones importa el catálogo de Tiendanube; Sincronizar SKU también lo actualiza antes de buscar coincidencias.

La comparación usa el SKU de cada variante y el SKU del producto del proveedor accesible al usuario. Quita espacios al principio y al final, pero conserva mayúsculas, signos y ceros iniciales. En Mercado Libre se usa SELLER_SKU, no seller_custom_field.

Solo se escriben asociaciones con una coincidencia única. Un SKU vacío, desconocido o compartido por varios productos del proveedor conserva la asociación anterior. Una coincidencia única puede reemplazar una asociación previa. En Mercado Libre se conservan las unidades por venta y se utiliza la cola de stock existente.

Esta integración importa publicaciones, guarda asociaciones y envía el stock del proveedor a cada variante asociada. Una unidad de la variante corresponde a una unidad del producto del proveedor. Tanto las asociaciones manuales y por SKU como los cambios de stock generan trabajos durables. El servidor intenta enviarlos después de guardar y el worker programado recupera pendientes y errores aunque el navegador esté cerrado. El cron actual corre una vez por hora. Un envío fallido queda visible en Publicaciones; un 401/403 requiere revisar escritura de productos y reconectar.

La migración `20261020211606_tiendanube_stock_sync.sql` agrega esa cola privada, genera los trabajos iniciales para las asociaciones existentes y registra los cambios de inventario. Las revisiones y los bloqueos temporales impiden que una respuesta antigua marque como terminado un cambio más reciente. El stock remoto solo se muestra como confirmado después de consultarlo en Tiendanube. La integración todavía no importa ventas de Tiendanube ni las descuenta del stock compartido.

La migración `20261020134220_tiendanube_catalog_sku.sql` agrega la tabla privada de conexiones y catálogos y las funciones de guardado. Las escrituras verifican propietario y versión; una importación fallida no reemplaza el catálogo guardado.

Referencias: [productos](https://tiendanube.github.io/api-documentation/resources/product), [tienda](https://tiendanube.github.io/api-documentation/resources/store), [aplicación a medida](https://ayuda.tiendanube.com/aplicaciones-a-medida/como-crear-una-aplicacion-a-medida-y-acceder-al-token-en-mi-tiendanube).
