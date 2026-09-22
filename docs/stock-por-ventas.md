# Stock compartido por ventas

Una orden pagada de cualquier vendedor descuenta del producto del proveedor y encola la cantidad restante para todas sus publicaciones asociadas, de todas las cuentas. Se descuenta `cantidad vendida × unidades por venta` de la asociación. El stock enviado a cada publicación sigue siendo la cantidad del producto, como en la etapa anterior; no se implementa reparto de cupos entre vendedores.

## Activar en producción

1. Desplegar esta versión. Hasta aplicar la migración, los avisos de órdenes de cuentas conectadas responden 503 para que Mercado Libre los reintente.
2. Ejecutar **completo y una sola vez** `supabase/migrations/20260922202559_sales_shared_stock.sql` en el SQL Editor de Supabase, después de `20260922124743_listing_stock_sync.sql`. Es aditiva: conserva productos, cantidades y asociaciones. No repetir `20260922120816_supplier_owned_single_stock.sql`, que era el reinicio anterior.
3. Ejecutar `supabase/enable-sales-worker.sql`. Crea la tarea `despachos-shared-stock` en Supabase Cron, cada hora al minuto cero. Solo llama al worker si hay trabajos pendientes elegibles para procesar. Usa `pg_cron` y `pg_net`; si el proyecto exige habilitarlos desde Integrations/Extensions, habilitarlos y ejecutar nuevamente este archivo. Repetir este archivo reemplaza el horario sin resetear inventario. Verificar su URL si cambia el dominio.
4. En la aplicación de desarrolladores de Mercado Libre, habilitar `orders_v2` y la URL de notificaciones `https://control-stock-ventas-despachos.vercel.app/api/meli/webhooks`. La URL OAuth `/api/meli/callback` es diferente. Cada vendedor debe tener conectada su cuenta y permisos de ventas y modificación de publicaciones.

No hay variables de entorno nuevas: el worker usa un secreto aleatorio creado en la tabla privada `sales_stock_config`. No copiarlo al navegador ni publicarlo. El cron lo lee dentro de la base de datos. El código usa las credenciales de servidor y OAuth ya configuradas.

La fecha de activación es el momento en que se ejecuta la migración. Solo se descuentan órdenes cuya `date_closed` sea igual o posterior. Cargar el stock inicial correcto al activar: no se importan ni se descuentan ventas históricas. No cambiar esa fecha hacia atrás para recalcular: las órdenes ya examinadas conservan su marca de procesamiento.

## Flujo y recuperación

- El webhook valida la aplicación y extrae únicamente el ID de orden de `/orders/ID`. Persiste el aviso antes de responder 200. No confía en importes, cantidades ni estados del aviso.
- El worker consulta la orden real con el token del vendedor conectado. Verifica ID, vendedor, fecha y líneas completas; rechaza respuestas parciales HTTP 206. Solo `paid` descuenta.
- PostgreSQL bloquea la orden y las existencias, agrega las líneas del mismo producto y guarda el movimiento y la propagación en una sola transacción. La clave cuenta/orden y el registro de débitos impiden descontar dos veces ante avisos duplicados, cambios posteriores de estado o reintentos.
- Cada publicación se actualiza con su cuenta propietaria; se verifica la cantidad mediante GET después del PUT. Una revisión nueva queda pendiente si cambia el stock durante una actualización anterior.
- `after()` inicia el trabajo al recibir una venta. Supabase Cron revisa pendientes cada hora sin necesitar una pestaña abierta y solo llama al worker cuando hay trabajo elegible. Cada ejecución trabaja un lote limitado; no es sincronización instantánea y la demora depende del volumen y de Mercado Libre. Si no llegan nuevas notificaciones, una falla puede esperar hasta la siguiente revisión horaria; un volumen mayor al lote puede necesitar más ejecuciones.
- Un error al leer/aplicar una venta queda habilitado para reintentar tras un minuto; una actualización de publicación, tras cinco minutos. Esos plazos mínimos no programan llamadas: el reintento ocurre cuando vuelve a ejecutarse el worker, por una notificación o el respaldo horario. También se puede reintentar una publicación desde Stock. Las reservas de trabajo vencen en cinco minutos si se corta un proceso.

## Casos que necesitan revisión

- Sin asociación activa al procesar: esa línea no se descuenta y se informa al vendedor/admin. No se descuenta retroactivamente al asociarla después; corregir el stock manualmente si corresponde.
- Stock insuficiente: queda en cero, se registra cuánto se pudo descontar y cuánto faltó, y se envía cero a las publicaciones. No se oculta la diferencia ni se generan cantidades negativas.
- Cancelación posterior al descuento: deja un aviso para revisar la reposición manual. No devuelve unidades automáticamente; una cancelación no confirma que la mercadería esté físicamente disponible.
- Full y stock administrado por depósitos mantienen las limitaciones de la sincronización anterior. Los errores aparecen en Stock.
- La asociación y sus unidades se leen al procesar la venta. No hay historial de asociaciones para reconstruir cambios anteriores. Las cantidades de una orden ya descontada no se vuelven a aplicar automáticamente.
- Depende de que Mercado Libre entregue el aviso: Cron recupera avisos persistidos, no busca órdenes faltantes en el historial. Tampoco puede garantizar que no haya sobreventas durante la propagación entre cuentas.

## Comprobación

En Supabase SQL Editor, sin mostrar secretos:

```sql
select activated_at from public.sales_stock_config;
select jobname, schedule, active from cron.job where jobname='despachos-shared-stock';
select order_id, status, processed, error, warning, updated_at
from public.sales_stock_jobs order by updated_at desc limit 20;
select order_id, variant_id, units, deducted, created_at
from public.sales_stock_debits order by created_at desc limit 20;
select item_id, status, error, updated_at
from public.listing_stock_jobs order by updated_at desc limit 20;
select status_code, timed_out, error_msg, created
from net._http_response order by created desc limit 10;
```

El cron debe obtener HTTP 200 cuando haya trabajo y se realice la llamada. Sin pendientes no genera una respuesta HTTP nueva. `cron.job_run_details` confirma la ejecución del SQL, no que el endpoint terminó correctamente; verificar también `net._http_response`. En una venta real posterior a la activación: el producto baja una vez, aparece un débito/movimiento y las publicaciones de los vendedores llegan a `done` con la nueva cantidad. Probar primero con un producto controlado. Las pruebas locales simulan las APIs y usan PostgreSQL embebido; no sustituyen esa comprobación de entrega real.

Para pausar el proceso periódico: `select cron.unschedule('despachos-shared-stock');`. Esto no detiene el procesamiento iniciado por nuevas notificaciones; para detener también nuevas ventas, deshabilitar el topic en la app de Mercado Libre y esperar a que terminen las ejecuciones en curso. No borrar las tablas de débitos: son la protección contra descuentos repetidos.
