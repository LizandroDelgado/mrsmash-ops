# MR. SMASH · ERP financiero ligero — Plan maestro

> Fuente de verdad para las Fases 1, 2 y 3. Actualizar al cerrar cada fase.
> Objetivo: que el dueño sepa **cuánto vendió, cuánto ganó de verdad y cuánto de su dinero ya está comprometido**, desde un Android, con una mano.

Negocio: smash burgers en Tepic, Nayarit. Abre martes a domingo, de 16:00 a 23:00; cierra lunes. Canales: WhatsApp/bot, salón (Soft Restaurant) y Didi Food.
Proyecto Supabase `effxuvviyhaksllmcrqh` · `negocio_id = 34797ee1-37fa-4736-ad56-35578a126b08` (single-tenant).

---

## 1. Estado actual (reconocimiento, 2026-10-29)

### Stack y estructura
- Next.js 14 (App Router) + Tailwind + PWA (next-pwa) · Supabase JS v2 · zustand (casi sin uso) · recharts · xlsx · date-fns.
- `app/` (todo `'use client'`):
  - `/` Pedidos del día con semana, KPIs, estados, cambiar fecha y borrar.
  - `/nuevo-pedido` con voz, canal y fecha.
  - `/insumos` compras.
  - `/finanzas` semana/mes con punto de equilibrio.
  - `/dashboard` KPIs mensuales.
  - `/importar` Excel de Didi.
- `app/api/*`: `pedidos`, `insumos`, `importar-didi`. Sólo se usa `importar-didi`; pedidos e insumos se escriben directo desde el cliente.
- `components/BottomNav.js`, `lib/supabase/client.js`, `lib/parsers/didiParser.js`, `lib/calculos.js`, `lib/dashboard.js`.
- Tema: fondo `#0a0a0a`, superficie `#141414` y `#1e1e1e`, borde `#2a2a2a`, marca `#FF4D00`, ok `#22c55e`, alerta `#eab308`, error `#ef4444`. Estilo inline con tarjetas `rounded-xl` o `rounded-2xl` y chips `py-3` de ancho completo.

### Hallazgos importantes
1. **API key:** la key legacy `eyJ…` de `.env.local` **es rechazada** ("Invalid API key"). La que funciona es la `sb_publishable_…` que está escrita directamente en `lib/supabase/client.js`. Con ella anon puede leer, insertar, actualizar, borrar y llamar RPC (RLS deshabilitado). **No se cambió el cliente.** Si se rota la key, hay que actualizar `client.js`.
2. **Zona horaria:** Tepic usa **America/Mazatlan (UTC−7)**, no America/Mexico_City (UTC−6). `dia_operativo()` usa Mazatlan con corte a las 05:00.
3. **Fechas en UTC:** la app calculaba "hoy" con `new Date().toISOString()`, que da la fecha **UTC**. Desde las 17:00 de Tepic eso ya es "mañana", y ~70 % de los pedidos históricos tienen `fecha` distinta de su día local. Se corrigió hacia adelante con `lib/dia.js → diaOperativo()` en Pedidos, Nuevo pedido e Insumos. **No se reescribió el histórico.**
4. **`pedidos.hora`** no es confiable: mezcla hora del navegador, captura tardía y el default del servidor en UTC. El ledger no la usa.
5. **Didi:** las importaciones (`importaciones_didi`, 507 filas) llegan sólo hasta 2026-05-17. Después de esa fecha el dueño captura los pedidos Didi en la app (`canal='didi'`, `total` = precio neto estimado). Finanzas y Dashboard suman las dos fuentes, así que hay doble conteo si se importa un periodo ya capturado.
6. `importaciones_didi` **no genera pedidos**. Su UNIQUE es `(negocio_id, fecha, venta_bruta, metodo_pago)`, que es pérdida: dos pedidos iguales el mismo día cuentan como uno. Pendiente para Fase 2.
7. `compras_insumos` incluye cosas que no son insumos (por ejemplo "empleado" por $2,500, en la categoría Otro). Con el ledger, la nómina va en Gastos fijos.
8. `productos.categoria` **no existe** en producción. Finanzas y Dashboard usan un fallback por nombre.
9. `clientes` existe pero anon no tiene permiso para leerla. No se toca.

### Esquema actual (columnas reales)
| Tabla | Columnas |
|---|---|
| negocios | id uuid, nombre, created_at |
| productos (11) | id, negocio_id, nombre, precio_venta, costo_insumos, disponible, orden, created_at, precio_whatsapp, precio_didi, precio_didi_neto |
| pedidos (301) | id, negocio_id, cliente_id, cliente_nombre, canal (`whatsapp`/`didi`/`manual`, sin CHECK), estado (`en_preparacion`/`listo`/`entregado`), total, notas, fecha date, hora time, created_at |
| pedido_items (565) | id, pedido_id, producto_id, nombre_producto, cantidad, precio, costo |
| compras_insumos (59) | id, negocio_id, descripcion, monto, categoria (Carne/Pan/Verdura/Salsas/Empaque/Otro), fecha date, created_at |
| importaciones_didi (507) | id, negocio_id, didi_order_id, fecha date, venta_bruta, comision_didi, costo_promos, ganancia_neta, metodo_pago, created_at |
| clientes | sin acceso con anon |

---

## 2. Diseño contable: ledger único

**Principio:** cada peso que entra o sale de una cuenta es una fila en `movimientos`. Los saldos no se guardan, se calculan.

**Adaptación:** `saldo = SUM(movimientos.monto)`. El saldo inicial **es un movimiento** de tipo `saldo_inicial`. `cuentas.saldo_inicial` sólo guarda como referencia la última cifra capturada y no se suma, para no contarlo dos veces. Al capturar un saldo, `fijar_saldo_inicial()` inserta la diferencia contra el saldo actual, así que se puede recapturar cuando sea.

### Día operativo
- SQL: `dia_operativo(ts timestamptz) → date` = `((ts AT TIME ZONE 'America/Mazatlan') - 5h)::date`. Todo `movimientos.dia_operativo` lo llena un trigger con esta función.
- JS: `lib/dia.js → diaOperativo()`, con el mismo criterio.
- Pedidos y compras guardan la `fecha` que declara el usuario. El movimiento se fecha con `ts_de_dia(fecha)`: `now()` si es hoy, o 20:00 local de ese día si no. Así `dia_operativo(mov.fecha) = fecha` del pedido.
- Casos límite probados: ver la sección 5.

### Tablas nuevas
Todas tienen `negocio_id` y `GRANT ALL` para anon, authenticated y service_role.

| Tabla | Notas |
|---|---|
| `cuentas` | + `clave` (`caja`/`banco`/`terminal`/`didi`), `orden`. Semilla: Caja efectivo, Banco, Terminal/Transferencias, Didi por cobrar, todas en 0. |
| `movimientos` | Según el spec, más `monto_bruto` (Didi: bruto − neto = comisión + promos + retenciones, dato para el dashboard) y el tipo extra `ajuste_didi`. |
| `proveedores` | + `activo`, para borrado suave. |
| `gastos_recurrentes` | + `fecha_inicio`. Índice único parcial: un solo `sueldo_dueno` por negocio. |
| `obligaciones` | + `compra_id`. `UNIQUE(gasto_recurrente_id, periodo)`. |
| `pagos_obligacion` | + `negocio_id`. |
| `cortes_caja` | + `movimiento_id`. `UNIQUE(negocio_id, cuenta_id, dia_operativo)`. |
| `configuracion_negocio` | Una fila. Defaults: 2 % de reserva, 7 días de reposición, food cost 32 %, sueldo 0, Didi deposita el lunes, corte a las 5. |
| `mapeo_productos_externos` | Para la Fase 1b (Soft). `UNIQUE(negocio_id, fuente, nombre_externo)`. |

### Columnas aditivas
- `pedidos`: `metodo_pago`, `cuenta_id`, `fuente_import` (default `'app'`), `folio_externo`, `cancelado` (default false), `total_bruto` (precio de plataforma para Didi) y `en_ledger`. Índice único parcial en `(negocio_id, fuente_import, folio_externo)`.
- `compras_insumos`: `metodo_pago`, `cuenta_id`, `proveedor_id`, `fecha_vencimiento`, `en_ledger`.
- `importaciones_didi`: `en_ledger`.
- **`en_ledger`**: es `false` en todo el histórico y los triggers lo ponen en `true` al insertar. Así editar, cancelar o borrar un registro viejo no genera reversos de movimientos que nunca existieron. **El ledger empieza el día de la migración** y los saldos arrancan con lo que el dueño capture en /configuracion.

### Triggers (ningún canal se salta el ledger)
| Evento | Efecto |
|---|---|
| INSERT pedido | Si `metodo_pago` es null, toma `didi` cuando el canal es didi y `efectivo` en otro caso. Cuenta: efectivo → Caja; transferencia o tarjeta → Terminal; didi → Didi por cobrar. Movimiento `venta` por `total` (para Didi `total` ya es el neto) con `monto_bruto = total_bruto`. |
| UPDATE pedido (total, cuenta, cancelado, fecha) | Revierte el neto vigente y vuelve a registrar si no está cancelado. |
| DELETE pedido | Revierte. Los movimientos nunca se borran. |
| INSERT compra | Efectivo → −Caja; transferencia → −Banco; crédito → obligación con vencimiento = fecha + `proveedores.dias_credito`. |
| UPDATE/DELETE compra | Revierte o cancela la obligación. Si la obligación ya tiene pagos, **se bloquea** con un mensaje claro. |
| INSERT importaciones_didi | Movimiento `venta` de `ganancia_neta` a Didi por cobrar, **salvo que** ese mismo día ya existan pedidos Didi capturados en la app (anti doble conteo por día). |
| DELETE importaciones_didi | Revierte. |
| UPDATE gastos_recurrentes | Actualiza las obligaciones futuras sin pagar. Si se desactiva, las cancela. Si cambia la frecuencia o el día, cancela y regenera. |
| configuracion_negocio.sueldo_dueno_semanal | Si es > 0, hace upsert de un gasto recurrente semanal `sueldo_dueno` que vence el lunes. Si es 0, lo desactiva. |

### Funciones RPC (se llaman desde el cliente, no desde API routes)
`saldo_cuenta`, `fijar_saldo_inicial`, `transferir`, `cobrar_didi`, `corte_caja`, `pagar_obligacion`, `generar_obligaciones(negocio, hasta)` y la vista `v_saldos_cuentas`.
- `cobrar_didi`: transfiere de Didi por cobrar a Banco el monto **real** depositado. Si hay diferencia con lo esperado, registra `ajuste_didi` para dejar Didi por cobrar en 0 y regresa la diferencia a la UI.
- `corte_caja`: esperado = saldo de Caja al cierre del día operativo. La diferencia se registra como `ajuste_corte` (categoría faltante o sobrante).
- `generar_obligaciones`: genera desde max(`fecha_inicio`, hoy) hasta `hasta`. Periodos: semanal `IYYY-Www`, mensual `YYYY-MM`, quincenal `YYYY-MM-Q1/Q2` (día N y N+15), bimestral cada 2 meses desde el mes de inicio. Es idempotente por `ON CONFLICT DO NOTHING`.

### Regla: sueldo del dueño
El sueldo semanal es OPEX (gasto recurrente `sueldo_dueno`). Los retiros adicionales son `retiro_dueno` y **no cuentan como gasto**, son reparto de utilidad.

### Canales y Didi
- Canales en Nuevo pedido: **WhatsApp, Salón, Didi**. "Manual" queda sólo en el histórico y el Dashboard lo agrupa con Salón.
- Forma de pago (Efectivo por default / Transferencia / Tarjeta) para WhatsApp y Salón. Didi siempre va a Didi por cobrar.

---

## 3. Migraciones (`supabase/migrations/`)
| Archivo | Contenido |
|---|---|
| `20261029_01_ledger_base.sql` | `dia_operativo`, `ts_de_dia`, tablas nuevas, columnas aditivas, semillas y grants |
| `20261029_02_ledger_triggers.sql` | Triggers, RPCs, vista de saldos y sueldo del dueño |
| `limpiar_test.sql` | Borra todo lo marcado como `TEST%`, incluidos los movimientos generados |

Todas son aditivas: `CREATE … IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE`. Sin DROP.

---

## 4. Pantallas (Fase 1)
- **Nav inferior (5):** Pedidos · Caja · Gastos · Inventario · Dashboard. El **menú ⋮** (en Caja, Gastos, Inventario y Dashboard) lleva a Compras de insumos, Finanzas, Importar Didi y Configuración.
- **/caja:** tarjeta "Dinero libre" (placeholder hasta la Fase 3) con el total líquido; saldos por cuenta (al tocar uno se filtran los movimientos); botones Retiro mío, Meter dinero, Pasar entre cuentas y Cobró Didi; **Corte de caja** con el esperado y la diferencia en vivo (verde, amarillo o rojo); últimos 100 movimientos. Si no hay saldos, muestra el estado vacío "Captura tus saldos de hoy".
- **/gastos:** pestañas Por pagar, Fijos y Proveedores. Por pagar muestra totales vencido / 7 días / 30 días, chip rojo si está vencida u hoy, amarillo si vence en 7 días o menos, Pagar (cuenta y monto prellenados, acepta abonos) y cancelar las manuales. Fijos tiene CRUD y el estado vacío "Agrega tu primer gasto fijo". Proveedores tiene CRUD con días de crédito en chips. El botón "+ Gasto" (gasto suelto) da a elegir entre "Ya lo pagué" (crea la obligación y la paga en el mismo paso) y "Lo debo".
- **/configuracion:** saldos de hoy por cuenta y parámetros de `configuracion_negocio`, incluido el sueldo semanal.
- **/inventario:** placeholder de la Fase 2 con acceso a compras.
- **Nuevo pedido:** canal Salón y chips de forma de pago. **Insumos:** forma de pago (Efectivo / Transfer. / A crédito), proveedor y vencimiento calculado.
- **Pedidos:** botón Cancelar/Reactivar (el ledger revierte la venta); los cancelados se excluyen de los totales en Pedidos, Finanzas y Dashboard.

---

## 5. Bitácora de cierre de Fase 1 (2026-10-29)

**Respaldo previo:** `pg_dump --schema=public` (esquema + datos) en `C:\Users\alwes\mrsmash_backups\mrsmash_public_20261029_1556.sql`, fuera del repo, de 219 KB. Conteos verificados: 301 pedidos, 565 items, 59 compras, 507 Didi, 11 productos.

**Aplicación:** `psql --single-transaction -v ON_ERROR_STOP=1` para cada migración. Ambas terminaron con exit 0.

**Hallazgo al aplicar:** el proyecto tiene el event trigger `ensure_rls` (`rls_auto_enable`), que activa RLS en toda tabla nueva de `public`. La migración 01 lo desactiva explícitamente en las 9 tablas nuevas. Cualquier tabla futura necesita lo mismo.

**Pruebas locales (PGlite, réplica del esquema):** 53 de 53. Cubren los casos límite de `dia_operativo` (23:59 → mismo día; 00:30 y 04:59 → día anterior; 05:00 → mismo día), la reaplicación idempotente de las migraciones y que el histórico no se toca.

**Pruebas en producción (API con la key de la app, datos TEST):**
| Criterio | Resultado |
|---|---|
| Pedido efectivo $300 → Caja +300; cancelar → vuelve; reactivar y borrar → vuelve | PASS |
| Compra a crédito $500, proveedor de 7 días → Por pagar vence 2026-11-05; pagar → Banco −500 y estado pagada | PASS |
| Borrar una compra ya pagada → bloqueado con mensaje | PASS |
| Corte con faltante de $20 → `ajuste_corte` de −20 visible en Caja | PASS |
| `generar_obligaciones` dos veces → 16 y luego 0 filas nuevas | PASS |
| Cobró Didi $10 menos → diferencia −10 y Didi por cobrar en 0 | PASS |
| Transferencia y retiro | PASS |
| `limpiar_test.sql` → 4 cuentas en $0, tablas del ledger vacías, histórico intacto | PASS |

**360 px (Chrome con emulación móvil):** sin scroll horizontal en las 8 pantallas, y los elementos táctiles miden ≥ 48 px. Se corrigió el botón "+ Pedido", que medía 36 px. Las hojas de Corte y Pagar se probaron.

`npm run build` pasa sin errores. Las advertencias de `themeColor` en metadata ya existían.

---

## 6. Pendiente

**Fase 1b pendiente: importador de Soft Restaurant, requiere export real.**

### Fase 1b: importador de Soft Restaurant
- `lib/parsers/softParser.js` con mapeo flexible de columnas (con y sin acentos) e informe de errores, siguiendo el patrón de `didiParser.js`.
- Pestaña "Soft Restaurant" en /importar, con vista previa (tickets, total, forma de pago, tipo de servicio, duplicados por folio).
- Productos sin mapear: asignarlos con un toque y guardarlos en `mapeo_productos_externos`.
- Excluir tickets de domicilio/WhatsApp para no contar doble, y recordar esa elección.
- Guardar en `pedidos` y `pedido_items` con `fuente_import='soft'` y `folio_externo`. Ya existen la tabla de mapeo, las columnas y el índice único.

### Fase 2: inventario y costo real
- Inventario por insumo, recetas (BOM) por producto, food cost real contra la meta y reposición a `dias_reposicion_inventario`.
- Didi: corregir la UNIQUE pérdida de `importaciones_didi` (usar el id de pedido si el reporte lo trae) y conciliar por pedido en vez de por día.
- Pasar Finanzas y Dashboard a leer del ledger y usar `dia_operativo` para agrupar.
- Crear `productos.categoria` (el SQL existe en `supabase/add_categoria_productos.sql`, pero no se aplicó).

### Fase 3: dinero libre y cashflow
- **Dinero libre** = líquido (Caja + Banco + Terminal) − obligaciones que vencen antes del próximo ingreso fuerte − reserva de impuestos (`tasa_reserva_impuestos` × ventas desde el último pago de impuestos) − reposición de inventario.
- Proyección de cashflow a 90 días: ventas promedio por día de la semana (operando de martes a domingo) + cobros Didi en `dia_pago_didi` − `generar_obligaciones(negocio, hoy+90)`.
- Utilidad real: ventas netas − insumos − OPEX (incluye el sueldo del dueño); los retiros quedan fuera.
