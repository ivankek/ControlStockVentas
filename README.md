# Despachos

Aplicación privada para liquidar al proveedor los productos efectivamente despachados. Next.js, React, TypeScript y Supabase (PostgreSQL + Auth). Moneda ARS, almacenada en centavos enteros.

## Estado de esta entrega

- Vista de ejemplo funcional, temporal y separada de los datos reales. No persiste al recargar.
- Costos con fecha de vigencia, confirmaciones manuales, resumen, CSV, copia e historial de pagos.
- API autenticada, migración PostgreSQL, OAuth con PKCE y tokens cifrados, importación de ventas e historial logístico implementados.
- La conexión real NO fue probada: faltan las cuentas/configuración de Supabase y Mercado Libre.
- Sin publicación ni servicios contratados: se acordó probar localmente primero y definir hosting antes de contratar.

## Ejecutar

Node.js 22 o superior. Desde esta carpeta:

```powershell
npm ci
npm run dev
```

Abrir http://127.0.0.1:3000. Sin variables de Supabase muestra exclusivamente datos de ejemplo.

```powershell
npm test
npm run typecheck
npm run build
```

## Conectar los servicios

1. Crear un proyecto dedicado de Supabase. Ejecutar `supabase/migrations/001_initial.sql` una vez en su SQL Editor. Deshabilitar el registro público de usuarios en Auth y crear únicamente los usuarios autorizados. Las tablas tienen RLS sin políticas públicas; únicamente las rutas del servidor acceden mediante la clave de servicio, después de verificar el usuario con `auth.getUser`.
2. Copiar `.env.example` a `.env.local`. Completar la URL y clave publicable de Supabase, y la clave de servicio en el servidor. Nunca compartir claves por chat ni subir `.env.local` a Git.
3. Crear una aplicación para **Mercado Libre** con permisos de consulta de ventas/envíos y PKCE. Es independiente de la app de cobros de Mercado Pago. Registrar como callback exactamente `APP_URL/api/meli/callback`. Para la conexión real utilizar una URL HTTPS estable aceptada por el portal; el loopback HTTP sirve para la vista local, no se presupone admitido por Mercado Libre.
4. Configurar `MELI_CLIENT_ID`, `MELI_CLIENT_SECRET` y `TOKEN_ENCRYPTION_KEY` (32 bytes aleatorios en base64). Reiniciar la aplicación cuando cambien variables. `APP_URL` no debe terminar en `/`.
5. Iniciar sesión en Conexión y pulsar Conectar Mercado Libre. Las credenciales OAuth se guardan cifradas con AES-256-GCM; el navegador solo recibe la autorización de Supabase. No se almacena la contraseña de Mercado Libre.
6. Importar ventas. Comparar manualmente fechas de varios Flex y Correo contra los despachos reales. Hasta entonces `MELI_DISPATCH_RULES_VERIFIED=false`: las fechas candidatas requieren confirmación. Cambiar a `true` solo después de verificar que los eventos elegidos representan la salida del proveedor.
7. Cargar costos. Para publicaciones en pack cargar el costo completo del pack. Se identifica cada publicación/variante por ID; aún no hay catálogo común para agrupar publicaciones diferentes del mismo producto.

## Reglas y límites importantes

- Flex opera lunes a sábado: antes de las 13:00, ese día; desde las 13:00, siguiente día operativo. Domingo no opera. Son previsiones; los feriados y excepciones requieren revisar la fecha que informa Mercado Libre.
- La etiqueta impresa y la entrega final no constituyen por sí solas evidencia de la fecha de despacho. Se utiliza el primer evento `shipped`, `ready_to_ship/picked_up` o `ready_to_ship/authorized_by_carrier`, incluyendo `status_history.date_shipped` cuando existe. Debe validarse por logística en esta cuenta.
- Acordar con el comprador requiere confirmación manual del paquete entregado al correo. No se modifica la venta en Mercado Libre.
- Importación inicial: últimas 90 jornadas de ventas, más todos los pedidos ya registrados en sincronizaciones posteriores. No se promete historial completo; la interfaz muestra este límite. Más de 10.000 ventas requieren particionar el importador antes de continuar. Una consulta fallida no guarda resultados parciales.
- Historial de estados, fechas y cantidades de la API deben verificarse en esta cuenta antes de uso operativo. Full y casos no contemplados aparecen como incidencias.
- Un cierre guarda una instantánea de líneas, costos e IDs; un cambio de costo no altera pagos previos. Los cierres solo incluyen pedidos no pagados. Las escrituras usan control de versión atómico en PostgreSQL para evitar dobles cierres concurrentes.
- Cancelaciones y reembolsos se señalan. No se descuentan automáticamente de un pago anterior: acordar el ajuste con el proveedor. El registro de notas de crédito y la reversión de pagos erróneos quedan para una siguiente iteración.
- El importador serializa solicitudes por usuario dentro del proceso Node. Antes de desplegar múltiples instancias, agregar bloqueo distribuido para la renovación de OAuth y una cola de sincronización; elegir hosting con duración suficiente para el volumen de pedidos. No hay sincronización programada todavía.
- El estado del negocio se guarda como documento JSONB por cuenta en PostgreSQL, con control de versión. Adecuado para el piloto; normalizar pedidos y costos e indexar por fecha antes de un crecimiento significativo.

## Referencias oficiales

- https://developers.mercadolibre.com.ar/envios
- https://developers.mercadolibre.com.ar/es_ar/publica-productos/gestiona-ventas
- https://developers.mercadolibre.com.ar/crea-una-aplicacion-en-mercado-libre-es
- https://supabase.com/docs
- https://nextjs.org/docs

La interfaz expone opcionalmente `read_dispatch_summary` mediante WebMCP (solo lectura). Sin soporte del navegador funciona igual.
