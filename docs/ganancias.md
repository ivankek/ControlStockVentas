# Despachos manuales, gastos y ganancias

## Persistencia

Se reutiliza `account_states.state.business` (sin migraciones ni variables nuevas):

- `notes[orderId]`: fecha de despacho manual, costo del envío acordado, neto recibido verificado opcional y fecha de modificación.
- `zones[]`: provincia, localidades y tarifas Flex con fecha de vigencia.
- `months[YYYY-MM]`: monotributo y cargos adicionales de la factura ML.

Los pedidos y pagos consultados siguen siendo temporales. No se guardan en Supabase.
Las mutaciones se hacen con la función existente de control de versión; preservan
catálogo, asociaciones y costos. Las notas se verifican con `/orders/{id}` contra
el vendedor conectado y con el envío antes de autorizar un despacho manual.
No se cambia nada en Mercado Libre. Solo los pedidos acordados admiten despacho
y envío manual. Se puede borrar una confirmación eligiendo No despachado.
Las confirmaciones de la fecha elegida se buscan incluso si la venta está fuera
de la ventana habitual de 90 días, siempre que ML aún la permita consultar.

## Cálculo

La pantalla Ganancias tiene filtros histórico, año, mes, semana (lunes a domingo)
y día; la fecha contable es la creación de la venta en horario argentino.
Bruto significa total vendido, según lo solicitado: `total_amount` en ARS de
órdenes pagadas. No es el margen bruto contable.

Neto estimado por venta = importe recibido − proveedor − envío propio.
Proveedor utiliza la asociación actual y el costo vigente en la fecha de venta,
con su multiplicador de unidades. Una edición retroactiva cambia el cálculo.
Flex busca una única coincidencia de provincia/localidad; permite variaciones
de mayúsculas, tildes y espacios, pero no inventa equivalencias geográficas.
Se usa la tarifa vigente en la fecha de venta. Un shipment compartido se cobra
una vez entre las órdenes consultadas, asignándolo a la primera por ID.
Si un carrito está dividido entre períodos, debe revisarse esa asignación.
Correo no recibe otra deducción de envío. Los envíos acordados usan el costo
manual de la venta; cero explícito significa que no hay costo, vacío es pendiente.

Se consulta `GET https://api.mercadopago.com/v1/payments/{id}` con la autorización
del vendedor. Se usa `transaction_details.net_received_amount` solo en pagos
aprobados en ARS del mismo collector, sin reembolso. No se infiere ese importe
restando únicamente `sale_fee`, ni se restan las comisiones nuevamente.
Una autorización sin acceso al pago deja el neto pendiente. Se puede cargar un
neto verificado manualmente por orden. Un pago compartido entre órdenes no se
suma repetidamente: requiere asignación manual por orden.

El neto de la API no garantiza conciliación con todo cargo facturado por separado,
reintegro Flex o ajuste posterior. Por eso el resultado está rotulado estimado.
Las devoluciones/cancelaciones no se computan como ventas normales: quedan a
revisar, sin inventar recuperos de producto ni costos de logística inversa.

Después se descuentan monotributo y cargos mensuales **adicionales** (publicidad
y otros no descontados de los pagos). No se debe ingresar el total de una factura
si contiene comisiones ya reflejadas en el neto recibido. La carga es manual,
no hay importación automática de facturas en esta versión.
Los gastos mensuales se distribuyen por días calendario, repartiendo los centavos
restantes entre los primeros días: la suma diaria coincide exactamente con el mes.
Mes no configurado es pendiente; mes con importes cero es confirmado sin gastos.

## Cobertura y consulta

Histórico consulta los últimos 365 días; la documentación ML indica hasta 12
meses de acceso a órdenes. No se puede reconstruir un histórico de toda la vida
sin otra fuente o almacenamiento histórico autorizado. La búsqueda del vendedor
también puede omitir cancelaciones, por lo que no reemplaza una conciliación.

El navegador consulta tramos de siete días, páginas de 50, hasta completar el
período, deduplicando por ID y rechazando páginas repetidas o totales cambiantes.
`POST /api/profit` acepta hasta 31 días por tramo y 10.000 resultados. Cada página
consulta envíos/pagos en lotes de cuatro y no consulta historiales de despacho.
No se muestra un total final si falla una página. Se puede cancelar la consulta.
El primer histórico puede tardar; resultados se descartan al salir de la sección.
Si faltan costos/importes o se excede la cobertura, muestra un subtotal parcial
y el detalle pendiente. No transforma un importe desconocido en cero.

## Validación y puesta en marcha

- `npm test`: reglas de fechas, propiedad de órdenes, lectura sin persistencia,
  pagos sin acceso, costos por vigencia, unidades, pagos/envíos compartidos y
  prorrateo con centavos/año bisiesto.
- `npm run build`.
- En producción: comparar una venta Flex, una de correo y una acordada con sus
  liquidaciones reales. El acceso real a pagos depende de permisos de la cuenta.
- No requiere configuración adicional en Supabase o Vercel; desplegar los cambios.

Fuentes consultadas:
- https://developers.mercadolibre.com.ar/es_ar/publica-productos/gestiona-ventas
- https://developers.mercadolibre.com.ar/es_ar/administra-areas-de-cobertura/pedidos-y-opiniones
- https://www.mercadopago.com.ar/developers/es/reference/online-payments/subscriptions/get-payment/get
