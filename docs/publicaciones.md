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
