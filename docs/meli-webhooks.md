# Notificaciones de Mercado Libre

`POST /api/meli/webhooks` recibe y acusa recibo únicamente. No guarda eventos,
consulta recursos, actualiza pedidos ni modifica stock o liquidaciones.
Los eventos aceptados ahora no quedan en una cola para procesarlos más adelante.

## Contrato

- JSON objeto con `topic` y `resource` como textos no vacíos, `user_id` y
  `application_id` como enteros positivos seguros o cadenas numéricas positivas.
- `application_id` debe coincidir con la variable existente `MELI_CLIENT_ID`.
- Se ignoran campos adicionales, incluyendo `id`, `_id`, `actions` y timestamps;
  no se exige que tengan la misma forma para todos los topics.
- Se aceptan topics desconocidos y repetidos. Cada recepción válida responde
  `200 {"received":true}` sin efectos de negocio.
- JSON o estructura inválidos: 400. Aplicación diferente: 403. Más de 64 KiB
  reales de cuerpo: 413. `MELI_CLIENT_ID` ausente o mal formado: 503.
- Solo se exporta POST. Next.js responde 405 para GET, HEAD, PUT, PATCH y DELETE;
  maneja OPTIONS automáticamente. Abrir la URL en una pestaña hace GET.

Se reconocen para diagnóstico `orders_v2`, `items`, `shipments`, `stock-location`,
`stock_locations`, `user_products`, `user_products_families` y
`user-products-families`. Todos reciben exactamente el mismo tratamiento.
Otros topics se registran como `unknown`, pero también se aceptan.

## Seguridad y límites

Referencia consultada: [Notificaciones de Mercado Libre](https://developers.mercadolibre.com.ar/es_ar/productos-recibe-notificaciones).
La guía consultada no especifica un protocolo de firma criptográfica de estos
callbacks; no se exige `x-signature` de Mercado Pago ni un secret inventado.
Comparar application_id verifica el destino declarado, **no autentica al emisor**.
El endpoint es público y cualquier persona puede construir un JSON aceptable.
Por eso no se confía en su contenido para modificar datos ni se visita `resource`.
No se implementa un filtro IP basado en headers reenviados sin verificar su
procedencia en la infraestructura.

Los logs contienen solo `event`, topic conocido o `unknown`, y
`disposition: acknowledged_only`; los rechazos incluyen una razón fija.
No se registran cuerpos, headers, IDs de cuentas, recursos, tokens ni errores
detallados del parser. Estos logs sirven para observar recepciones, no como
auditoría durable ni prueba de autenticidad. Vercel agrega la hora al registro.

La respuesta no espera consultas externas. La guía pide responder en 500 ms;
el arranque en frío y la infraestructura pueden afectar ese tiempo.
Antes de implementar efectos habrá que validar los recursos con la cuenta
conectada, guardar/encolar de forma durable antes del 200 y agregar deduplicación
y procesamiento asíncrono. Nada de eso se implementa en esta etapa.

## Deploy y comprobación

Hace falta publicar este cambio en Vercel. No hay migraciones ni variables nuevas.
Verificar que `MELI_CLIENT_ID` esté cargada en Production. Para OAuth, `APP_URL`
debe ser `https://control-stock-ventas-despachos.vercel.app` sin barra final;
el código ya agrega `/api/meli/callback` y utiliza Authorization Code, Refresh
Token y PKCE. No usa Client Credentials. Los permisos ampliados por sí solos
no activan funciones nuevas.

En PowerShell, después del deploy:

```powershell
$meliAppId = Read-Host 'Application ID de Mercado Libre (no el client secret)'
$payload = @{
  topic = 'items'
  resource = '/items/MLA_TEST_WEBHOOK'
  user_id = '123456789'
  application_id = $meliAppId
} | ConvertTo-Json
Invoke-WebRequest -Method Post -Uri 'https://control-stock-ventas-despachos.vercel.app/api/meli/webhooks' -ContentType 'application/json' -Body $payload
```

Resultado esperado: HTTP 200 con `{"received":true}`. Repetirlo también debe
responder 200. En **Vercel → proyecto → Logs**, filtrar por
`/api/meli/webhooks` o `meli_webhook_received` y observar `acknowledged_only`.
Este ejemplo sintético verifica el receptor, no la conexión de Mercado Libre.
Para verificar entregas reales, autorizar la aplicación con la cuenta vendedora,
mantener habilitados los topics/callback y observar una notificación al ocurrir
un evento real. Confirmar horarios con los registros; no realizar ventas ficticias.
La consulta manual por fecha muestra las ventas temporalmente, sin guardarlas en la base de datos.

Pruebas locales: `npm test` y `npm run build`.
