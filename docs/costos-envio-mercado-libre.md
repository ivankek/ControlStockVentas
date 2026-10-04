# Costos de envío en Ganancias

Las ventas conservan la búsqueda y paginación actuales. Si la orden ya trae un
shipment_id, se reutiliza. Si falta y existe pack_id, se consulta /packs/{id} y
se comprueba que incluya la orden. Luego se consultan /shipments/{id} y /costs.

shippingCosts contiene importes en centavos ARS: shippingGrossCents,
buyerShippingCostCents, sellerShippingCostCents y shippingPromotedCents.
Un importe null es desconocido; 0 solo representa un cero informado.
shippingDiscounts conserva type, rate y promoted_amount (este último en pesos,
como en la API). isFlex se determina exclusivamente por self_service.

Se selecciona el sender de la cuenta. Un único sender sin user_id es aceptado;
uno identificado como otro vendedor no lo es. sellerShippingCostCents ya es el
costo final. No se calcula bruto menos subsidios. Un campo discounts ausente
deja el subsidio en null, mientras que una lista vacía informa suma cero.

El neto actual parte de net_received_amount de Mercado Pago. No se le descuenta
otra vez sellerShippingCostCents: podría estar incluido. La logística propia del
transportista sigue siendo un concepto separado. La conciliación de acreditaciones
Flex se pospone; /api/profit/flex queda disponible para una integración posterior,
pero ya no se llama automáticamente al consultar ganancias.

Por instrucción del usuario, shippingPromotedCents se trata como ingreso Flex
en la aplicación. Si el recibido coincide con la base del desglose del pago,
se agrega una vez. Si coincide con base más bonificación, ya está incluido.
Si falta el desglose o el importe no concilia, el neto queda pendiente. El neto
manual se considera total y no se modifica. Envíos compartidos requieren
asignación manual del recibido. Movimientos contables explícitos tienen prioridad
sobre este importe; no se suman las dos fuentes. Correo mantiene el dato informativo.

Los errores de packs, shipments o costs se exponen en shippingError y no eliminan
ventas. Promesas compartidas evitan llamadas duplicadas, incluso ante fallos.
Cada consulta crea un UUID; las páginas reutilizan una caché por usuario, cuenta,
vendedor y credencial en la misma instancia del servidor (5 minutos, máximo 8
consultas y 2000 recursos por mapa). En otra instancia se consulta nuevamente.
No se persiste en la base ni se comparten datos entre consultas nuevas.

Fuentes: https://developers.mercadolibre.com.ar/gestion-packs y
https://developers.mercadolibre.com.ar/es_ar/publica-productos/mercado-envios-costos-y-cotizaciones
