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
3. **Fechas en UTC:** la app calculaba "hoy" con `new Date().toISOString()`, que da la fecha **UTC**. Desde las 17:00 de Tepic eso ya es "mañana". Se corrigió hacia adelante con `lib/dia.js → diaOperativo()` en Pedidos, Nuevo pedido e Insumos.
   - **Corrección del diagnóstico (Fase 3):** el "~70 % con fecha distinta" comparaba `fecha` contra `created_at`, pero `created_at` es la hora de **captura** (60 % de los pedidos se capturó de 1 a 6 días después, casi siempre de mañana). El error UTC real afectó a 40 pedidos; ver la sección 4c.
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
| `20261029_03_inventario.sql` | Fase 2: insumos, recetas, kardex, conteos, desglose de compras, triggers, vistas y RPC de inventario y food cost |
| `20261029_04_fase21.sql` | Fase 2.1: categoría `prestamo`, convención de fin de mes, `gramos_por_porcion`, `costo_origen`, notas de receta |
| `20261029_05_semilla_real.sql` | Fase 2.1: datos reales del dueño (21 insumos, recetas de 11 productos, 8 gastos fijos). Idempotente |
| `20261029_06_dashboard.sql` | Fase 3: `pedidos.dia_operativo_corregido`, bases de análisis (`v_pedidos_base`, `v_items_base`), devengo de OPEX, rentabilidad, dinero comprometido, cashflow y RPC `dashboard` |
| `20261030_07_precios_costos.sql` | Panel de precios y costos: `productos.categoria` y `precio_salon`, % de Didi en configuración, `costo_insumos` derivado de la receta, historiales y RPC por lotes |
| `limpiar_test.sql` | Borra todo lo marcado como `TEST%`, incluidos los movimientos generados, el inventario de prueba y su historial de precios y costos |

Todas son aditivas: `CREATE … IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE`. Sin DROP de tablas, columnas ni datos. **Única excepción (04):** el CHECK de `gastos_recurrentes.categoria` se quita y se vuelve a poner más amplio (con `prestamo`), porque Postgres no permite editar un CHECK.

---

## 4. Pantallas (Fase 1)
- **Nav inferior (5):** Pedidos · Caja · Gastos · Inventario · Dashboard. El **menú ⋮** (en Caja, Gastos, Inventario y Dashboard) lleva a Compras de insumos, Finanzas, Importar Didi y Configuración.
- **/caja:** tarjeta "Dinero libre" (placeholder hasta la Fase 3) con el total líquido; saldos por cuenta (al tocar uno se filtran los movimientos); botones Retiro mío, Meter dinero, Pasar entre cuentas y Cobró Didi; **Corte de caja** con el esperado y la diferencia en vivo (verde, amarillo o rojo); últimos 100 movimientos. Si no hay saldos, muestra el estado vacío "Captura tus saldos de hoy".
- **/gastos:** pestañas Por pagar, Fijos y Proveedores. Por pagar muestra totales vencido / 7 días / 30 días, chip rojo si está vencida u hoy, amarillo si vence en 7 días o menos, Pagar (cuenta y monto prellenados, acepta abonos) y cancelar las manuales. Fijos tiene CRUD y el estado vacío "Agrega tu primer gasto fijo". Proveedores tiene CRUD con días de crédito en chips. El botón "+ Gasto" (gasto suelto) da a elegir entre "Ya lo pagué" (crea la obligación y la paga en el mismo paso) y "Lo debo".
- **/configuracion:** saldos de hoy por cuenta y parámetros de `configuracion_negocio`, incluido el sueldo semanal.
- **/inventario:** (Fase 2, ver la sección 4b).
- **Nuevo pedido:** canal Salón y chips de forma de pago. **Insumos:** forma de pago (Efectivo / Transfer. / A crédito), proveedor y vencimiento calculado.
- **Pedidos:** botón Cancelar/Reactivar (el ledger revierte la venta); los cancelados se excluyen de los totales en Pedidos, Finanzas y Dashboard.

---

## 4b. Fase 2: inventario valorizado y recetas

### Diseño
- **El stock no se guarda:** `stock = SUM(inventario_movimientos.cantidad)`, en `unidad_base` (g, ml, pza). En pantalla, kg/L cuando pasa de 1000.
- **Kardex** `inventario_movimientos`: tipos `inicial`, `compra`, `consumo_venta`, `merma`, `ajuste_conteo`. `dia_operativo` lo llena el trigger. Nunca se borran: se revierten con filas inversas **con la misma fecha del original** (cancelar hoy una venta de ayer corrige el consumo de ayer).
- **Costo promedio ponderado** (`insumos.costo_promedio`): sólo lo mueven las entradas con costo propio (`compra`, `inicial`). Fórmula: `(stock × cp + q × costo) / (stock + q)`; si el stock era ≤ 0, el costo nuevo es el de la compra. El reverso de una compra saca su aportación. Consumos, mermas y ajustes salen o entran al promedio vigente.
- **Desviación del spec:** 6 decimales (`numeric(14,6)`) en lugar de 4 en `costo_promedio`, `costo_unitario` y `factor_conversion`, porque la papa cuesta $0.07875/g y con 4 decimales se redondeaba.
- Todas las tablas nuevas llevan `negocio_id`, incluidas `compra_items` y `conteo_items` (si no viene, `compra_items` lo toma de la compra).

### Triggers
| Evento | Efecto |
|---|---|
| INSERT/UPDATE/DELETE `compra_items` | Entrada `compra` de `cantidad × factor_conversion` a `costo_total / cantidad_base`; recalcula el promedio. Editar o borrar revierte. Borrar la compra borra el desglose en cascada y revierte. |
| UPDATE `compras_insumos.fecha` | Re-fecha las entradas del desglose. |
| INSERT `pedido_items` (pedido del ledger, no cancelado; cualquier canal) | Por cada línea de receta: `consumo_venta = −cantidad receta × cantidad vendida`, al promedio vigente. Productos sin receta no consumen y no truenan. |
| UPDATE `pedido_items` (cantidad/producto), DELETE | Revierte y vuelve a consumir. |
| UPDATE `pedidos.cancelado` / `fecha` | Revierte todas las partidas y, si sigue vigente, vuelve a consumir. |
| Primera compra real de un insumo (04) | `costo_origen` pasa a `'compras'`. |
- El histórico (`en_ledger = false`) no consume inventario.
- Las compras sin desglose siguen siendo gasto de insumos en finanzas, pero no mueven inventario.

### Conteos y arranque
- `conteos_inventario` (un solo conteo abierto a la vez) + `conteo_items` (UNIQUE `conteo_id, insumo_id`). Es un conteo a ciegas: la teórica no se muestra mientras se cuenta.
- `cerrar_conteo`: teórica = stock en `conteos_inventario.fecha` (inicio del conteo), diferencia = física − teórica, ajuste `ajuste_conteo` por la diferencia, `valor_diferencia = diferencia × costo_promedio` (merma o sobrante). Guarda `valor_inventario` para el food cost real.
- **Arranque (decisión de la Fase 2.1):** si un insumo nunca ha tenido `inicial` ni `ajuste_conteo`, su primer conteo registra la diferencia como `inicial` ("Arranque: primer conteo"): fija el stock y **no cuenta como merma**. Así las ventas anteriores al primer conteo (stock teórico negativo) no aparecen como un sobrante gigante. Desde el segundo conteo, las diferencias son merma.
- `v_stock_insumos.contado` indica si el insumo ya tiene punto de partida. Los no contados se muestran "sin contar" y no entran al valor ni a la lista de compras.
- `carga_inicial(negocio, items, notas)`: alta en lote + movimientos `inicial` + un registro `conteos_inventario` de tipo `inicial` (ancla para el food cost real), todo en una transacción.
- Merma directa: INSERT en `inventario_movimientos` con `tipo='merma'`, cantidad negativa y `motivo`.

### Vistas y funciones
- `v_stock_insumos`: stock, valor (stock × costo_promedio), consumo diario (consumo neto de los últimos 14 días entre los días que abre, martes a domingo, desde el primer consumo), días de cobertura, `bajo_minimo`, `gramos_por_porcion`, `costo_origen`, `contado`.
- `v_costo_receta`: costo actual por producto = Σ(cantidad receta × costo_promedio), contra `productos.costo_insumos`; `diferencia` es null si el producto no tiene receta.
- `food_cost(negocio, desde, hasta)`:
  - **Venta neta** = movimientos `venta` del ledger en el periodo.
  - **Teórico** = consumo por receta valorizado + **respaldo** para lo vendido sin receta (`pedido_items.costo`, que viene de `productos.costo_insumos`) / venta neta.
  - **Real** = (inventario inicial + compras − inventario final) / venta neta, si hay conteo o carga inicial cerrados el día `desde` o el anterior, y conteo el día `hasta` o el siguiente. Compras = entradas del kardex entre ambos conteos + compras sin desglose del periodo. Si no hay anclas: teórico + mermas y ajustes, marcado `estimado`.
- `resumen_conteo`, `cerrar_conteo`, `carga_inicial`, `stock_insumo`, `valor_inventario`, `insumo_tiene_base`.

### Pantallas
- **/inventario:**
  - Valor del inventario, número de insumos bajo mínimo y botón "Contar inventario" (o "Continuar conteo").
  - Accesos a Merma, Recetas y Alta de insumos.
  - Alerta "Productos sin receta".
  - Food cost teórico vs real de la semana o el mes, contra la meta.
  - Lista de compras: bajo mínimo o cobertura menor a `dias_reposicion_inventario`; cantidad = máx(consumo × días, mínimo) − stock, redondeada a 100 g/ml o a piezas enteras; costo estimado. Se copia como texto o se abre en WhatsApp, agrupada por proveedor y sin costos.
  - Existencias por categoría. Al tocar un insumo se edita su mínimo, categoría, proveedor o baja, y se registra merma.
  - Sin insumos, muestra el estado guía "1. Da de alta tus insumos → 2. Arma tus recetas → 3. Haz tu primer conteo".
- **/inventario/conteo:**
  - Un insumo por pantalla, con input grande y "Siguiente", "Anterior" y "No lo conté". Se puede retomar un conteo abierto.
  - Al final, un resumen valorizado; los insumos de primer conteo aparecen como "Arranque".
  - Desde ahí se cierra o se descarta el conteo.
- **/inventario/recetas:**
  - Lista de productos con su costo de receta y margen. Si el costo de receta difiere del registrado, un botón sincroniza `costo_insumos` (nunca automático).
  - Detalle de cada producto:
    - Líneas con cantidad editable y costo en vivo.
    - Margen en $ y %, y una nota por línea (por ejemplo "Por confirmar").
    - Buscador con los insumos más usados como chips, y alta de insumo en línea sin salir.
- **/inventario/carga:** alta en lote (nombre, unidad, categoría, stock de hoy, costo por kg/L/pza, mínimo) con una sola RPC.
- **Compras de insumos:** después de guardar, "Agregar insumos de esta compra" (opcional). Cada compra tiene su botón 📦 con el número de partidas. Hoja de desglose:
  - Chips con los últimos insumos comprados y buscador con alta en línea.
  - Unidad de compra: kg/g, L/ml, piezas o caja (piezas por caja).
  - Insumos en porción también se compran por kg o L: la pantalla pide los gramos por porción una vez, los guarda en `insumos.gramos_por_porcion` y usa `factor_conversion = 1000 / gramos_por_porcion`.
- Menú ⋮: + "Recetas y costos".

### Fase 2.1
- **Préstamos:** categoría `prestamo` en `gastos_recurrentes`, con la etiqueta "Pago de préstamo" en /gastos. `obligaciones.categoria` no tiene CHECK, así que acepta `prestamo` sin cambios. Regla para la Fase 3 en la sección 6.
- **Fin de mes:** convención `dia_pago = 31` = último día del mes. `generar_obligaciones` ya recortaba al último día real; /gastos ofrece "Último día del mes". Quincenal acepta días 1–15.
- **Semilla real (05):**
  - 21 insumos con `costo_origen='excel'` y sin stock (arranca con el primer conteo).
  - Recetas de los 11 productos. "Papas Sencillas" se asignó a "Papas a la francesa", confirmado por el dueño. El tocino de Papas Smash va marcado "Por confirmar".
  - 8 gastos fijos mensuales que vencen el último día del mes y se pagan del Banco.
  - `costo_insumos` **no** se sincronizó.

| Producto | Costo receta | Cifra del dueño | `costo_insumos` (sin tocar) |
|---|---|---|---|
| Smash Sencilla / Promo | 52.58 | 52.58 | 49 |
| Bacon Smash | 60.58 | 60.58 | 61 |
| Doble Smash | 71.43 | 71.43 | 70 |
| Doble Bacon Smash | 79.43 | 79.43 | 75 |
| Malteadas (×3) | 24.60 | 24.60 | 20 |
| Papas a la francesa | 10.33 | 10.33 | 12 |
| Papas Smash | 21.83 | 21.83 | 20 |
| Refresco | 20.00 | 20.00 | 8 |

---

## 4c. Fase 3: dashboard, dinero libre y cashflow

### Día operativo corregido del histórico
- Columna `pedidos.dia_operativo_corregido`. `fecha` y `hora` originales **no se tocan**.
- `created_at` **no sirve** para recalcular el día: es la hora de captura. Recalcular con él mandaba 99 pedidos al jueves.
- La base es la fecha que declaró el dueño. El error UTC de la app vieja sólo pegó en capturas **nocturnas** con los botones de fecha. Regla aprobada por el dueño (A+B): estos pedidos van **un día antes**.
  - **A:** se tocó "Hoy" entre las 17:00 y las 04:59 → la fecha quedó en la fecha UTC (día operativo + 1). 14 pedidos.
  - **B:** se tocó "Ayer" entre las 17:00 y las 23:59 → la fecha quedó en el día de captura en vez del anterior. 26 pedidos. Ejemplo: 4 pedidos del lunes 3 de agosto, capturados ese lunes a las 20:11, pasan al domingo 2.
- Los registros nuevos toman `dia_operativo_corregido = fecha` por trigger, porque la app ya calcula la fecha con `diaOperativo()`.

| Día | Antes (`fecha`) | Después (corregido) |
|---|---|---|
| Lun | 4 | **0** |
| Mar | 59 | 70 |
| Mié | 66 | 62 |
| Jue | 31 | 38 |
| Vie | 49 | 35 |
| Sáb | 45 | 49 |
| Dom | 47 | 47 |

### Un solo lugar para los datos
- **`v_pedidos_base`:** pedidos no cancelados, con día corregido y canal (`manual` → salón), más las importaciones Didi de días sin pedidos Didi capturados (sin doble conteo). Las ventas históricas de WhatsApp y Didi se ven desde el primer día.
  - **Didi capturado no trae desglose:** venta bruta = `total_bruto`, o Σ partidas, o `total`. Comisión, promos y retenciones se estiman con las tasas reales en vivo de `importaciones_didi` (`v_didi_tasas`): **comisión 23.6 %, promos 16.7 %, retenciones 4.6 %**.
  - **Desviación del spec:** el spec decía que las promos eran ≈ 24.1 %; los datos dan 16.7 %. Se usa el dato en vivo.
  - **Importaciones:** usan sus montos reales.
  - **`hora`:** sólo cuando el pedido se capturó en vivo (mismo día operativo, entre las 16:00 y las 04:59). El heatmap lo aclara: "basado en N de M pedidos".
- **`v_items_base`:** partidas con su costo. Usa el consumo valorizado de la receta (Fase 2) o, si no hay, el respaldo `pedido_items.costo` / `productos.costo_insumos` (`costo_respaldo`).
- **`costo_ventas_periodo`:** partidas + estimado para importaciones Didi, que no traen productos: venta bruta × razón costo/bruta de los pedidos Didi con partidas. Se muestra marcado.
- **OPEX devengado (`v_obligaciones_devengo`, `opex_periodo`):** cada obligación recurrente se reparte en su periodo (semana que termina en el vencimiento, mes, quincena o bimestre). Las manuales se cuentan en su día. Excluye canceladas y compras a crédito.
  - Ejemplo: la renta de octubre ($6,000) aporta $6,000 × 6/31 a la semana del 26 de octubre.
  - **Préstamos fuera de OPEX:** aparecen como "Pago de préstamos" debajo de la utilidad operativa.
  - **Antes del 29 de octubre no hay gastos fijos registrados**, así que periodos anteriores muestran OPEX en 0.
  - El dashboard llama a `generar_obligaciones` hasta el fin del mes consultado antes de calcular.
- **`lista_compras` (SQL):** la misma regla para /inventario y para el dinero comprometido. Sustituye la función JS de la Fase 2.

### Fórmulas (`resumen_periodo`, todo por día operativo, sin cancelados)
- Venta neta = bruta − comisión − promos − retenciones de Didi (en los otros canales neta = bruta). Ticket promedio = neta / tickets.
- Food cost = costo de ventas / venta neta (teórico). Si hay conteos que anclen el periodo, también el real de `food_cost()`.
- Utilidad operativa = neta − costo de ventas − OPEX (incluye `sueldo_dueno`, excluye `prestamo`).
- Prime cost = (costo de ventas + nómina + sueldo del dueño) / neta.
- Margen de contribución por burger = (neta − costo de ventas) / burgers.
- Punto de equilibrio = ⌈OPEX / margen por burger⌉ burgers; en $ = burgers × neta por burger.
- Margen de seguridad = (neta − equilibrio $) / neta.
- Reserva de impuestos = neta × `tasa_reserva_impuestos`. Se usa la venta neta porque Didi ya retiene impuestos sobre su parte.
- Margen por producto y canal (`margenes_producto`) = precio neto del canal − costo de receta (o `costo_insumos` si no hay receta). Didi neto = precio Didi × (1 − 44.9 %).
- Inventario: valor (sólo insumos contados), días de inventario = valor / costo de ventas diario, rotación = costo de ventas / valor, merma $ y % de la venta.
- Efectivo:
  - Saldos y Didi por cobrar aparte.
  - Diferencias de corte y retiros del periodo.
  - Gasto fijo diario = OPEX mensual de plantilla / 30.4.
  - Runway = disponible / (gasto fijo diario + compras diarias de los últimos 28 días).

### Dinero comprometido (`dinero_comprometido(negocio, horizonte=30)`)
- `dinero_total` = caja + banco + terminal. `por_cobrar_didi` va aparte y no cuenta como disponible.
- `comprometido` es la suma de tres partes, con detalle línea por línea en `lineas`:
  - Obligaciones pendientes o parciales que vencen hasta hoy + horizonte, incluidas las vencidas (`generar_obligaciones` se corre antes).
  - Reposición de inventario: Σ `lista_compras`.
  - Reserva de impuestos del mes: venta neta del mes × tasa − impuestos pagados en el mes.
- `dinero_libre` = total − comprometido.
- Semáforo: verde si libre ≥ OPEX semanal (plantilla × 7 / 30.4), amarillo si ≥ 0, rojo si es negativo.
- `sin_saldos`: no existe ningún movimiento `saldo_inicial`. La pantalla pide capturar saldos primero.

### Cashflow (`cashflow_proyectado(negocio, semanas=8, factor_ventas=1)`)
- **Semanas:** la semana 1 va de mañana a 7 días; saldo inicial = `dinero_total` de hoy.
- **Ventana de ventas:** las 4 semanas que terminan en el último día con ventas (si el dueño dejó de capturar, no se promedian ceros); lunes = 0.
- **Entradas:**
  - Directas (efectivo y terminal): entran el mismo día, con el promedio por día de semana.
  - Didi: lo vendido entra el `dia_pago_didi` de la **semana siguiente**.
  - El Didi por cobrar actual entra en la primera fecha de pago.
- **Salidas:**
  - Compras promedio semanales, **sin las de crédito** (ésas ya son obligaciones).
  - Obligaciones pendientes por vencimiento; las vencidas van a la semana 1 y cada obligación se cuenta una sola vez.
  - Sueldo del dueño y retiros promedio, por separado.
- **Pesimista:** `factor_ventas = 0.8` aplica a las ventas proyectadas, no al Didi ya por cobrar.

### Insights (`lib/insights.js`, reglas sin IA)
Recibe los agregados de las RPC y devuelve máximo 5 tarjetas, ordenadas por gravedad (rojo, amarillo, info) y luego por impacto estimado en $. Reglas:
1. Food cost arriba de la meta o +2 pts sobre el promedio de 4 semanas, con los insumos que subieron más de 5 % en su última compra.
2. Margen por burger Didi vs WhatsApp, con lo que ganas al pasar el 25 % de los pedidos Didi.
3. Promos Didi mayores que la comisión.
4. Ingeniería de menú (estrella, caballo, enigma, perro), con cortes en el promedio de unidades y margen.
5. Día más flojo vs más fuerte (promedio de 8 semanas).
6. Lo que vence en 7 días es mayor que el efectivo.
7. Merma mayor al 3 % de la venta, con los 3 insumos que más se pierden.
8. Faltantes de caja mayores a $100 en 7 días.
9. Debajo del punto de equilibrio a mitad de mes, con las burgers por día que faltan.
10. Insumos con cobertura menor a 2 días.

### Pantalla /dashboard (reemplaza a /dashboard y a /finanzas)
- Periodo: Hoy, Semana, Mes u Otro, siempre comparado con el periodo anterior de la misma duración.
- Orden de arriba a abajo:
  1. Dinero libre con semáforo; al tocarlo, el desglose de lo apartado.
  2. Seis KPIs con delta y una explicación (i).
  3. Insights.
  4. Estado de resultados en lenguaje simple.
  5. Gráficas:
     - Ventas por día apiladas por canal.
     - Heatmap día × hora.
     - Margen por burger y canal.
     - Lo que más vendes.
     - Food cost semanal contra la meta.
  6. Cashflow de 8 semanas (gráfica y tabla), con interruptor "Ventas −20 %"; la primera semana negativa se marca en rojo.
  7. Inventario y efectivo.
- Cada bloque sin datos muestra "Falta capturar X" con enlace a su pantalla.
- /finanzas redirige a /dashboard y salió del menú ⋮. `lib/dashboard.js` se eliminó.
- **Colores de canal:** Salón #3987e5, Didi #d95926, WhatsApp #199e70. Validados con el script de dataviz sobre #141414: ΔE CVD 9.4, contraste ≥ 3:1.
- Los datos llegan en 4 RPC agregadas en paralelo; el cliente no recibe filas crudas.

---

## 4d. Diseño de marca (2026-10-30)

La identidad es la misma que la de la página pública. **Sólo se cambió la apariencia:** no se tocó lógica, consultas ni base de datos.

### Tokens y tipografía
- **Fuente única de color:** `app/globals.css` define los tokens en CSS: claro por default; oscuro con `prefers-color-scheme` o `data-theme="dark"`.
  - Superficies: `--cream`, `--paper`, `--paper-2`.
  - Texto: `--ink`, `--ink-soft`, `--ink-mute`.
  - Naranja: `--orange`, `--orange-deep`, `--orange-text`, `--orange-fill`, `--on-orange`.
  - Semánticos: `--good`, `--warn`, `--bad`, cada uno con `-ink`, `-soft` y `-line`.
  - Banda oscura fija: `--band*`. Canales: `--ch-*`.
- `tailwind.config.js` expone los tokens como clases.
- **Cero hex fuera de esos dos archivos.**
  - `components/ui.js → C` sólo contiene `var(--…)`.
  - Recharts recibe los colores resueltos con `lib/useTokens.js`, que se recalcula al cambiar el tema.
- **Tipografía (next/font):** Fredoka 500/600/700 para títulos, montos grandes, botones y tabs; Manrope para todo el texto. Números tabulares en toda la app.
- **Tema:**
  - Selector Sistema / Claro / Oscuro en /configuracion, guardado en `localStorage('tema')`.
  - Un script en `<head>` pone `data-theme` antes de pintar, sin parpadeo.

### Contraste AA
Se agregaron tokens de texto sin cambiar los colores de marca:
| Token | Valor | Por qué |
|---|---|---|
| `--orange-text` | claro #B83500 | El naranja #FF4D00 como texto da 3.3:1 |
| `--orange-fill` | claro #C93A00 | Chips seleccionados con texto chico: blanco a 5.1:1 |
| `--on-orange` | oscuro #1C1512 | Blanco sobre #FF6A2B da 2.86:1 |
| `--good-ink`, `--warn-ink` | claro #17733F, #8C5A10 | #1F8A4C y #B7791F como texto no pasan 4.5:1 |

- El botón principal usa #FF4D00 con Fredoka 600 de 20px: es texto grande, que pasa a 3.33:1.
- La banda tiene sus propios semánticos (`--band-good`, `--band-warn`, `--band-bad`, `--band-accent`), iguales en ambos temas.

### Gráficas
- **Canales:** WhatsApp #FF4D00, Didi #1C1512 (en oscuro #F7EFE6), Salón #E0A93B.
- **Validador de dataviz:** la separación para daltonismo pasa (ΔE ≥ 21.8). Advierte que Salón tiene 2.1:1 sobre blanco en claro y que Didi "se lee gris". Se mantuvieron por decisión de marca, con leyenda siempre visible, separación de 2px entre segmentos apilados y valores en el tooltip.
- **Heatmap:** `color-mix()` de `--heat-0` (crema) a `--orange`.

### PWA
- `manifest.json`: íconos `/brand/icon-192.png` y `/brand/icon-512.png` (`any` y `maskable`), `background_color` #FFF8EE, `theme_color` #FF4D00. El `apple-touch-icon` es `/brand/apple-touch-icon.png`.
- Los íconos viejos de `public/` se conservan.
- Capturas a 360 px de las 8 pantallas en claro y oscuro: `docs/rediseno/`.

---

## 4e. Precios y costos (2026-10-30)

### Principios
1. **El histórico no se reescribe.** `pedido_items` guarda el precio y el costo de cada venta; todo cambio aplica sólo hacia adelante.
   - Verificado: ninguna de las 565 partidas históricas tiene costo 0.
   - `v_items_base` usa siempre el costo guardado en la venta. Antes, si una partida tenía costo 0, usaba `productos.costo_insumos` actual, que habría recalculado el pasado.
   - `trg_pedido_items_defaults` llena precio y costo vigentes sólo en partidas NUEVAS que lleguen sin ellos (por ejemplo, del bot); nunca toca filas existentes.
2. **Una sola fuente de costo: la receta.** `productos.costo_insumos` es derivado y se sincroniza solo:
   - al cambiar una receta (`recetas_sync`);
   - al cambiar el costo de un insumo, sea por compra o manual (`insumos_costo`);
   - al tocar el producto (`productos_precios`, BEFORE).
   - Sólo los productos SIN receta conservan `costo_insumos` editable. La RPC rechaza el costo manual de un producto con receta.
   - Esto cierra el pendiente "decidir si se sincroniza `costo_insumos`": sí, automático.
   - Se quitaron los botones "Sincronizar" y "Usar receta" de /inventario/recetas.
3. **Todo cambio queda en historial:**
   - `historial_precios`: campo, valor anterior y nuevo, motivo, fecha. Registra `precio_whatsapp`, `precio_didi`, `precio_salon`, `precio_venta` y el `costo_insumos` manual.
   - `historial_costos`: costo por unidad base anterior y nuevo, origen (`manual` o `compra`) y motivo.
   - El kardex marca el origen al recalcular el promedio por compra.
   - El motivo viaja en `set_config('mrsmash.motivo')` dentro de la transacción de la RPC.

### Precios por canal
| Canal | Columna | Notas |
|---|---|---|
| WhatsApp | `precio_whatsapp` | Nuevo pedido y bot |
| Salón | `precio_salon` (nuevo) | Antes la app cobraba el precio de WhatsApp. Arranca igual a WhatsApp, y un producto nuevo toma WhatsApp por default. |
| Didi | `precio_didi` | Bruto (lo que paga el cliente) |
| — | `precio_didi_neto` | `precio_didi × (1 − comisión − promos)`. Para **margen y utilidad**. |
| — | `precio_didi_cobro` (nuevo) | `precio_didi × (1 − comisión − promos − retenciones)`. Lo que entra a **Didi por cobrar** (Nuevo pedido lo usa como total). |
| — | `precio_venta` | Precio de lista histórico. Ninguna venta lo usa; Recetas y el dashboard dejaron de usarlo para márgenes. |

- `productos.categoria` (burger, papas, malteada, bebida) se aplicó desde `supabase/add_categoria_productos.sql`. `v_items_base` y `margenes_producto` cuentan burgers por categoría, con la regla por nombre como respaldo.

### Didi: tres porcentajes en `configuracion_negocio`
Prellenados con el histórico real de 507 importaciones (venta bruta $174,432):
| Concepto | Columna | Cálculo | Valor |
|---|---|---|---|
| Comisión | `pct_comision_didi` | $41,207.44 / $174,432 | 23.62 % |
| Promos | `pct_promos_didi` | $29,091.45 / $174,432 | 16.68 % |
| Retenciones | `pct_retenciones_didi` | ($174,432 − 41,207.44 − 29,091.45 − 96,091.09) / $174,432 | 4.61 % |

- **Margen y utilidad = sólo comisión + promos.** Las retenciones (ISR/IVA) son anticipo de impuestos, no costo del producto.
- **Efectivo = comisión + promos + retenciones.**
  - Lo que entra a Didi por cobrar: `precio_didi_cobro`.
  - El depósito esperado en `cashflow_proyectado`: `neta − retenciones`.
- **`v_pedidos_base`:** `neta = bruta − comisión − promos`. La columna `retenciones` va aparte.
  - En importaciones, `retenciones = bruta − comisión − promos − ganancia_neta` sin recortar (hay filas con bonificación), así que `neta − retenciones = ganancia_neta`, exactamente lo depositado.
- **Dashboard:** "Impuestos retenidos por Didi" aparece como línea aparte debajo de la utilidad.
- **Cambiar un % recalcula el neto y el cobro de todos los productos** (trigger `config_didi`). Se eliminaron los 0.235 / 0.241 / 0.476 escritos en SQL.
- **`meta_margen_minimo_pct`** (default 55 %): margen de contribución mínimo sobre lo que entra.
- **Semáforo de margen:**
  - verde si el costo de comida ≤ `meta_food_cost`;
  - ámbar si el margen ≥ `meta_margen_minimo_pct`;
  - rojo si queda debajo.

### RPC y lecturas
- **`aplicar_cambios_precios_costos(payload)`:** aplica `{ negocio_id, motivo, costos[], recetas[], precios[] }` en una sola transacción. Si un id no existe, un precio es negativo o se intenta poner costo manual a un producto con receta, revierte todo el lote.
- **`volumen_productos`:** unidades de las 4 semanas que terminan en el último día con ventas. Lo usa el cálculo de impacto en la utilidad del mes.
- **`alertas_costos`:** insumos que subieron ≥ 3 % en 60 días, con el producto más afectado. Alimenta el insight del dashboard: "El costo de X subió Y % desde [fecha]; tu margen en P bajó $Z; precio sugerido $W".
- **`GET /api/menu`:** menú vigente leído de la base en cada llamada, sin caché. **El bot de WhatsApp no vive en este repo** (sólo el Dockerfile de Evolution API): debe leer de aquí para tomar precios nuevos sin redeploy.

### Pantalla /configuracion/precios-costos
Se entra desde un botón grande en Configuración. Cuatro pestañas:
1. **Productos:**
   - Agrupados por categoría. Cada producto muestra costo, precio por canal y margen en $ y % con semáforo.
   - Detalle del producto:
     - Precios por canal con margen, costo de comida y neto/depósito Didi en vivo.
     - "Sugerido $X": el margen meta con el costo actual, redondeado hacia arriba a terminación 9; en Didi descuenta comisión + promos.
     - Disponible / Pausado.
     - Editor de receta, que es el mismo componente `components/EditorReceta.js` de /inventario/recetas, en modo lote.
2. **Insumos:**
   - Por categoría, con costo por kg / L / pieza, fecha y origen del último cambio.
   - Editor "como lo compras" ($350 por 1 kg, $95 por 12 piezas), con el **impacto** antes de guardar: costo y margen de cada producto que lo usa, y la utilidad del mes con el volumen de las últimas 4 semanas.
   - Alta de insumo y desactivar (no borra).
3. **Masivo:** "Subir precios X %" por categoría y canal, con terminación 9 y vista previa con márgenes. "Subió un insumo X %", con su impacto.
4. **Historial:** precios y costos, filtrable por nombre.

**Al guardar:**
- Todo se acumula en un lote. "Revisar y guardar (N)" abre el resumen antes → después con motivo opcional; un solo botón llama la RPC.
- Después queda un recordatorio fijo (guardado en `localStorage`) para actualizar Soft Restaurant y Didi Food, con la lista para copiar.

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

## 5b. Bitácora de cierre de Fases 2 y 2.1 (2026-10-29)

**Respaldo previo:** `pg_dump --schema=public` en `C:\Users\alwes\mrsmash_backups\mrsmash_public_20261029_1815.sql` (268,575 bytes). Conteos: 301 pedidos, 565 items, 59 compras, 507 Didi, 11 productos, 0 movimientos.

**Aplicación:** 03 y 04 con `psql --single-transaction -v ON_ERROR_STOP=1`, exit 0; RLS desactivado en las 6 tablas nuevas. Después corrieron las pruebas TEST y `limpiar_test.sql`, y al final la 05 (semilla real), también en una sola transacción. La semilla va al final para que las recetas TEST del Doble Smash no tocaran insumos reales.

**Pruebas locales (PGlite, réplica del esquema; migraciones aplicadas dos veces):**
- Inventario: 48/48.
- Semilla, fin de mes y préstamos: 26/26. Incluye 31 oct, 30 nov, 31 dic, 28 feb 2027, 29 feb 2028, 30 abr y 30 jun; el CHECK sigue rechazando categorías inválidas; el arranque por primer conteo; y la mayonesa comprada por kg a 15 g/porción.
- Regresión de la Fase 1: 53/53.

**Pruebas en producción (API con la key de la app, datos TEST):**
| Criterio | Resultado |
|---|---|
| Carga inicial en lote de 4 insumos → $405 | PASS |
| Compro 5 kg de carne a $900 → +5000 g, $0.18/g, origen `compras`; otros 5 kg a $1000 → 10000 g, promedio $0.19/g | PASS |
| Vendo 1 Doble Smash → carne −180, pan −1, queso −2, caja −1; cancelo → vuelve; reactivo → consume; borro → vuelve | PASS |
| Conteo: pan 18 contra teórico 20 → `ajuste_conteo` −2 y merma −$16; carne sin base → arranque, sin merma | PASS |
| Merma directa | PASS |
| Lista de compras: sólo el pan bajo mínimo, 30 − 16 = 14 pza ≈ $112; texto "• TEST Pan brioche: 14 pza" | PASS |
| Sincronizar `costo_insumos` con la receta (producto TEST) | PASS |
| `limpiar_test.sql` → inventario y ledger en 0, cuentas en $0, histórico intacto, Doble Smash sigue en $70 | PASS |
| Semilla: 21 insumos `excel`, sin stock; `v_costo_receta` = las 11 cifras del dueño; 8 gastos día 31 Banco | PASS |
| `generar_obligaciones` a 90 días: 24 y luego 0, sin duplicados (31 oct, 30 nov, 31 dic; $28,800/mes, de ellos $7,800 de préstamos) | PASS |

**360 px:** sin scroll horizontal y sin botones de menos de 44 px en /inventario, recetas (lista y detalle), carga, conteo, la hoja de merma, Compras, Gastos (hoja de gasto fijo con "Último día del mes"), Caja y Pedidos. Los costos unitarios y de receta se muestran con centavos (`formatMXN2`).

---

## 5c. Bitácora de cierre de Fase 3 (2026-10-29)

**Respaldo previo:** `C:\Users\alwes\mrsmash_backups\mrsmash_public_20261029_2151_pre_fase3.sql` (332,060 bytes). Conteos: 301 pedidos, 565 items, 507 Didi, 21 insumos, 98 líneas de receta, 24 obligaciones.

**Aplicación:** la 06 con `psql --single-transaction -v ON_ERROR_STOP=1`, exit 0. Resultado en producción: 40 pedidos corregidos, 0 sin día, lunes 4 → 0. Coincide con la prueba local.

**Pruebas locales:** réplica PGlite **con el histórico real** cargado del respaldo y las migraciones 01–06 aplicadas dos veces: 27/27. Las suites anteriores siguen pasando: 26/26, 48/48 y 53/53.

**Los 3 KPIs verificados a mano en producción (datos TEST, día de hoy sin ventas reales):**
- **Datos de prueba:**
  - Producto "TEST Smash" (WhatsApp $180, Didi $250) con una receta de 150 g de "TEST carne" a $0.20/g.
  - Saldo TEST de $50,000 en Banco.
  - Un pedido WhatsApp en efectivo, 2 × $180 = $360.
  - Un pedido Didi con bruto de $250.
- **Venta neta** = 360 + (250 − 23.62 % → 59.06 − 16.68 % → 41.69 − 4.61 % → 11.53) = 360 + 137.72 = **$497.72**. La RPC dio $497.72.
- **Food cost** = consumo de receta 3 burgers × 150 g × $0.20 = $90; $90 / $497.72 = **18.08 %**. La RPC dio 90 y 0.1808.
- **Dinero libre:**
  - Tienes = 50,000 (Banco) + 360 (Caja, por el pedido en efectivo) = $50,360.
  - Obligaciones pendientes en 30 días = $28,800 (los 8 fijos del 31 de octubre).
  - Reposición = $0, porque ningún insumo contado está bajo mínimo ni con poca cobertura.
  - Impuestos = 2 % × venta neta de octubre $24,905.40 = $498.11.
  - Libre = 50,360 − 28,800 − 0 − 498.11 = **$21,061.89**. La RPC dio $21,061.89, en verde porque la OPEX semanal es de $4,835.53.
- La venta del mes se calculó a mano en JS desde las tablas crudas (`pedidos` + `pedido_items` + `importaciones_didi`), no desde las vistas.

**Otros criterios en producción:**
- Sin saldos: `sin_saldos = true` y la pantalla pide capturarlos. Hoy sin ventas: no truena (venta 0, food cost null).
- Las ventas históricas se ven: junio $24,660.97 netos en 81 tickets; marzo, sólo con importaciones Didi, con comisión real.
- Cashflow: Σ de obligaciones de las 8 semanas = pendientes del horizonte ($57,600), sin duplicar. El saldo arranca en el total de hoy y encadena. El Didi por cobrar ($137.75) entra en la semana del primer lunes, y las entradas Didi sólo aparecen en semanas con lunes. El escenario pesimista da −20 % exacto en las entradas directas.
- Tiempos: las RPC del dashboard tardan 633 ms en paralelo (más `generar_obligaciones`); la pantalla muestra contenido en 1.4 s.
- `limpiar_test.sql`: 0 TEST, cuentas en $0, real intacto.

**360 px:** sin scroll horizontal en /dashboard (mes, desglose de lo comprometido y junio con escenario pesimista). /finanzas redirige a /dashboard.

**Observaciones de los datos reales:**
- El histórico de octubre tiene 10 pedidos con 169 burgers: muchos días se capturaron como un pedido agregado. Por eso el ticket promedio histórico sale alto ($2,491). Se corrige solo al capturar un pedido por ticket.
- El último día con ventas es el 10 de octubre: el cashflow promedia las 4 semanas que terminan ahí.

---

## 6. Pendiente

**Fase 1b pendiente: importador de Soft Restaurant, requiere export real.**

### Fase 1b: importador de Soft Restaurant
- `lib/parsers/softParser.js` con mapeo flexible de columnas (con y sin acentos) e informe de errores, siguiendo el patrón de `didiParser.js`.
- Pestaña "Soft Restaurant" en /importar, con vista previa (tickets, total, forma de pago, tipo de servicio, duplicados por folio).
- Productos sin mapear: asignarlos con un toque y guardarlos en `mapeo_productos_externos`.
- Excluir tickets de domicilio/WhatsApp para no contar doble, y recordar esa elección.
- Guardar en `pedidos` y `pedido_items` con `fuente_import='soft'` y `folio_externo`. Ya existen la tabla de mapeo, las columnas y el índice único.

### Siguientes pasos de inventario (operación, no código)
- Hacer el primer conteo físico: arranca el stock.
- Confirmar el tocino de Papas Smash.
- ~~Decidir si se sincroniza `costo_insumos` con las recetas~~ → automático desde la migración 07 (sección 4e).
- Si ya se pagaron los gastos fijos de octubre, cancelar las obligaciones del 31 oct en Por pagar.

### Siguientes pasos (después de la Fase 3)
- Capturar los saldos de hoy en /configuracion: activa el dinero libre real.
- Capturar un pedido por ticket, en vivo, para tener ticket promedio, heatmap y food cost por pedido confiables.
- Insights con IA sobre los mismos agregados (hoy son reglas).
- ~~`productos.categoria`~~ → aplicada en la migración 07.
- Conectar el bot de WhatsApp a `GET /api/menu` (su código no está en este repo).

### Pendientes técnicos heredados de la Fase 2
- Didi: corregir la UNIQUE pérdida de `importaciones_didi` (usar el id de pedido si el reporte lo trae) y conciliar por pedido en vez de por día.
- Pasar Finanzas y Dashboard a leer del ledger y usar `dia_operativo` para agrupar.
- Crear `productos.categoria` (el SQL existe en `supabase/add_categoria_productos.sql`, pero no se aplicó).

### Fase 3: dinero libre y cashflow (HECHO, ver la sección 4c)
**Regla de préstamos (Fase 2.1, implementada):** la categoría `prestamo` **NO** entra en OPEX, utilidad operativa ni punto de equilibrio operativo; **SÍ** entra en dinero comprometido (obligaciones que vencen) y en el cashflow proyectado.
- **Dinero libre** = líquido (Caja + Banco + Terminal) − obligaciones que vencen antes del próximo ingreso fuerte − reserva de impuestos (`tasa_reserva_impuestos` × ventas desde el último pago de impuestos) − reposición de inventario.
- Proyección de cashflow a 90 días: ventas promedio por día de la semana (operando de martes a domingo) + cobros Didi en `dia_pago_didi` − `generar_obligaciones(negocio, hoy+90)`.
- Utilidad real: ventas netas − insumos − OPEX (incluye el sueldo del dueño); los retiros quedan fuera.
