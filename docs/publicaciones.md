# Publicaciones

La sección Publicaciones lee el catálogo guardado al abrirse. El botón Importar
publicaciones / Actualizar publicaciones consulta Mercado Libre y guarda cambios
en Supabase. No publica ni modifica datos en Mercado Libre.

Se usa `account_states.state.listings`, un catálogo JSON por usuario, compatible
con la migración existente. No hay tablas o variables nuevas. Cada publicación
se identifica por su ID de Mercado Libre; las variantes se guardan dentro de ella.
No se crean registros repetidos en cada importación.

Se comparan ID, vendedor, título, precio, moneda, stock, estado y variantes
(ID, precio, stock y atributos de combinación). Campos ajenos a esta selección,
como la fecha técnica de actualización de Mercado Libre, no provocan escrituras.
Si nada cambia, no se llama a la función de guardado ni se modifica la versión
del estado. Si hay cambios se guarda atómicamente el documento de la cuenta con
el catálogo combinado, preservando pedidos, costos y liquidaciones existentes.
No es una tabla SQL con una fila por publicación: se reutiliza el modelo JSON
actual. Una publicación que no aparece en una consulta no se borra automáticamente.

La API autenticada `GET /api/listings` devuelve el catálogo guardado.
`POST /api/listings` realiza la importación y devuelve added, updated, unchanged
y listings. Se usa el vendedor vinculado al usuario autenticado, nunca un ID
de vendedor enviado desde el navegador.

La búsqueda usa scan/scroll, obtiene todos los IDs primero y consulta detalles
en grupos de cinco solicitudes. Se limita a 10.000 publicaciones por importación.
El límite de duración es 300 segundos; catálogos mayores o redes lentas pueden
requerir un trabajo en segundo plano en una futura versión. Un fallo aborta antes
de guardar. Hay bloqueo por usuario dentro del proceso y control optimista en la
base para rechazar catálogos modificados por otra importación simultánea.

Los precios son de venta, no costos del proveedor. Los despachos siguen siendo
consultas temporales; este cambio no los persiste. La renovación de tokens mantiene
su comportamiento anterior.

Pruebas: `npm test` y `npm run build`. Después de desplegar, importar una vez,
repetir sin cambios (debe indicar sin cambios) y comprobar que las publicaciones
persistan al recargar. Para verificar una actualización, usar un cambio real de
precio o estado hecho en Mercado Libre y volver a importar.

Referencia: https://developers.mercadolibre.com.ar/es_ar/guia-para-carrito-de-compras/items-y-busquedas

## Opciones de venta y proveedor

Actualizar publicaciones incorpora `user_product_id` y `listing_type_id`.
Las opciones del mismo UP se agrupan visualmente. También se reúnen publicaciones
con nombre exacto normalizado y variantes iguales, según la preferencia del vendedor;
no se utiliza similitud aproximada ni se eliminan colores o talles del nombre.
Cada opción conserva su ID, precio, stock, estado, cuotas y condición de envío gratis.
No se suma el stock porque puede ser compartido. La asociación del grupo se aplica a
todas sus opciones y variantes. Si hay asociaciones diferentes se muestra una advertencia.
La cantidad por venta es 1 por defecto y se edita con el botón Cambiar; valores ya
configurados se conservan. Datos de cuotas y envío ausentes requieren actualizar.
Las cuotas se interpretan según listing_type_id y tags documentados para MLA;
no se infiere una financiación a partir del precio.

En Costos se crean productos del proveedor con nombre, costo unitario ARS y fecha
de vigencia. Se guardan en `account_states.state.supplierProducts`; las asociaciones
en `supplierLinks`, aparte del catálogo importado. Actualizar publicaciones no
sobrescribe estos datos. Las opciones de un UP comparten asociación y las opciones
nuevas del mismo UP pueden resolverla después de actualizar el catálogo.
Las asociaciones actuales se usan para todas las fechas consultadas; los costos
sí tienen historial de vigencia. Editar un costo con la misma fecha reemplaza el
valor de esa fecha. No es un registro histórico de liquidaciones cerradas.

La asociación incluye unidades del proveedor por venta (por ejemplo, pack de 3
unidades: factor 3). Si el proveedor vende el pack completo como un producto con
costo propio, el factor es 1. Kits de varios productos distintos deben registrarse
como un producto del proveedor con costo del kit; no se implementan composiciones.

Despachos lee costos y asociaciones, sin guardar los pedidos. Calcula cantidad
vendida × factor × costo vigente al día del despacho. Muestra costo por pedido,
resumen por producto del proveedor y total del día. Sin asociación, sin costo
vigente o con incidencias, se muestra subtotal incompleto/a revisar. Los pedidos
sin fecha verificable no se suman. Este cálculo no registra pagos ni descuenta
pagos anteriores. No se requieren migraciones o variables nuevas.
