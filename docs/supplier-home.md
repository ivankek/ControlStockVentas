# Inicio del proveedor

El perfil SUPPLIER abre Inicio al ingresar. Cada cuenta pertenece a un vendedor con una relación activa en supplier_sellers. El servidor comprueba el perfil y la relación antes de consultar; vuelve a comprobarla antes de devolver las ventas. No se exponen credenciales ni datos de compradores.

Mercado Libre: consulta ventas pagadas pendientes de envío, verifica el estado actual y clasifica por expected_date de /shipments/{id}/sla, en horario argentino. Incluye hoy y atrasados; excluye futuros, Full y envíos ya retirados o despachados. Los plazos o estados que no pudieron verificarse quedan para revisión. Los límites de tiempo y paginación muestran advertencias de resultados parciales.

Tiendanube: consulta pedidos abiertos y pagados pendientes de envío usando los filtros de estado admitidos por el endpoint de órdenes. Requiere permiso de lectura de pedidos. Si falta ese permiso, el panel indica que hay que habilitarlo en la aplicación y volver a conectar la tienda. Como esta consulta no aporta un plazo de despacho verificable, aparecen para revisar.

El detalle de ventas incluye productos del proveedor y líneas sin asociación. Las publicaciones del catálogo guardado aparecen primero sin asociación y después asociadas. Las asociaciones de otros proveedores se identifican sin exponer sus productos o costos. No se modifican pedidos ni stock desde este panel.
