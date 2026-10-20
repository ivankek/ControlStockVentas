# Tiendanube y asociaciones por SKU

En Conexión, el vendedor ingresa el ID de tienda y el token de una aplicación a medida de Tiendanube con lectura de productos. El servidor verifica la tienda y el acceso al catálogo antes de guardar el token cifrado. El token no se devuelve al navegador.

Publicaciones muestra una sección por plataforma conectada. Actualizar publicaciones importa el catálogo de Tiendanube; Sincronizar SKU también lo actualiza antes de buscar coincidencias.

La comparación usa el SKU de cada variante y el SKU del producto del proveedor accesible al usuario. Quita espacios al principio y al final, pero conserva mayúsculas, signos y ceros iniciales. En Mercado Libre se usa SELLER_SKU, no seller_custom_field.

Solo se escriben asociaciones con una coincidencia única. Un SKU vacío, desconocido o compartido por varios productos del proveedor conserva la asociación anterior. Una coincidencia única puede reemplazar una asociación previa. En Mercado Libre se conservan las unidades por venta y se utiliza la cola de stock existente.

Esta integración de Tiendanube importa publicaciones y guarda asociaciones. No envía stock ni importa ventas de Tiendanube.

La migración `20261020134220_tiendanube_catalog_sku.sql` agrega la tabla privada de conexiones y catálogos y las funciones de guardado. Las escrituras verifican propietario y versión; una importación fallida no reemplaza el catálogo guardado.

Referencias: [productos](https://tiendanube.github.io/api-documentation/resources/product), [tienda](https://tiendanube.github.io/api-documentation/resources/store), [aplicación a medida](https://ayuda.tiendanube.com/aplicaciones-a-medida/como-crear-una-aplicacion-a-medida-y-acceder-al-token-en-mi-tiendanube).
