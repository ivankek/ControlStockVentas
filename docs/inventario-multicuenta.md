# Inventario multicuenta

La migración `002_inventory.sql` es aditiva. No edita ni borra `001_initial.sql`, `account_states` ni `meli_connections`. Debe ejecutarse en el proyecto Supabase antes de publicar el código.

## Aplicación segura

1. En Supabase abrí **SQL Editor**, revisá que sea el proyecto correcto y ejecutá el contenido completo de `supabase/migrations/002_inventory.sql` una sola vez.
2. Confirmá que existan `app_profiles`, `meli_accounts`, `supplier_variants`, `supplier_inventory`, `inventory_movements`, `meli_listings` y `listing_mappings`.
3. Asigná el primer administrador desde SQL, usando el UUID real del usuario creado en Authentication:

```sql
update public.app_profiles
set role = 'ADMIN'
where id = 'UUID_DEL_USUARIO_ADMIN';
```

No uses el correo en React ni permitas que el navegador ejecute este cambio.

La migración copia la conexión cifrada existente a `meli_accounts` y sus publicaciones importadas a `meli_listings`, verificando el `seller_id`. La tabla anterior queda preservada para la transición. El catálogo anterior no se adjudica automáticamente: desde **Usuarios → Asignar catálogo anterior** un ADMIN elige el proveedor real. La acción es transaccional, conserva costos, asociaciones y `units_per_sale`, habilita la relación con ese vendedor y no se puede repetir.

## Modelo

`app_profiles` distingue el usuario de la aplicación (`ADMIN`, `USER`, `SUPPLIER`) del `seller_id` de Mercado Libre. `meli_accounts` permite varias cuentas por ADMIN o USER; `seller_id` es único y los tokens siguen cifrados. `supplier_sellers` guarda la relación explícita proveedor–vendedor.

`supplier_products → supplier_variants → supplier_inventory` representa el stock físico central. La variante sin opciones se llama `Única`. `supplier_costs` conserva el historial por fecha. `listing_mappings` vincula una publicación y variación de una cuenta concreta con una variante física, sus unidades por venta y la política `REAL` o `FIXED`.

El stock vendible es `max(físico - reservado - seguridad, 0)`. Los ajustes permitidos por ahora son `MANUAL_ADJUSTMENT`, `RESTOCK` y `CORRECTION`. `inventory_command` bloquea la fila de inventario, valida invariantes, registra el movimiento y actualiza la versión dentro de la misma transacción. Acepta un `request_id` idempotente para reintentos. `SALE`, `CANCELLATION` y `RETURN` están preparados en el historial, pero no se generan todavía.

## Alcance deliberadamente pendiente

Esta etapa no descuenta stock por ventas, no envía `PUT available_quantity`, no pausa publicaciones, no procesa efectos de `orders_v2` y no ejecuta cron. Las pantallas muestran el stock deseado y las asociaciones, pero la sincronización automática de Mercado Libre queda para la próxima etapa.

Despachos y Ganancias siguen consultando ventas temporalmente y conservan sus cálculos de costos vigentes. La cuenta se elige explícitamente para no mezclar vendedores ni cuentas.

## Verificación local

`npm test`, `npm run typecheck` y `npm run build` pasan. La prueba opcional `tests/inventory-postgres.test.ts` se ejecuta únicamente si se define `INVENTORY_TEST_DATABASE_URL` con una base local descartable cuyo nombre sea `/despachos_inventory_test`; comprueba RLS, permisos, migración, rollback, idempotencia y dos ajustes concurrentes `2 → 1 → 0`.
