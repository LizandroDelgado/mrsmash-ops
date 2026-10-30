-- ============================================================
-- MR. SMASH ERP · Fase 3 · Migración 06: día operativo corregido, base de ventas y dashboard
-- Aditiva: ADD COLUMN, CREATE OR REPLACE. fecha y hora originales de pedidos NO se tocan.
-- ============================================================

-- ════════════════════════════════════════════════════════════
-- 1) Día operativo corregido del histórico
-- ════════════════════════════════════════════════════════════
-- Diagnóstico (2026-10-29): created_at es la hora de CAPTURA, no de venta (60% de los pedidos
-- se capturó 1–6 días después, casi siempre de mañana), así que no sirve para recalcular el día.
-- La fecha declarada por el dueño es la base. El error UTC de la app vieja sólo afectó capturas
-- NOCTURNAS con los botones de fecha (la app ya iba un día adelante en UTC):
--   A) "Hoy" capturado de 17:00 a 04:59 local → fecha = fecha UTC (día operativo + 1)
--   B) "Ayer" capturado de 17:00 a 23:59 local → fecha = fecha UTC − 1 (día de captura, no el anterior)
-- Regla A+B aprobada por el dueño: esos pedidos van 1 día antes (40 pedidos; lunes queda en 0).
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS dia_operativo_corregido date;

UPDATE pedidos p
SET dia_operativo_corregido = CASE
  WHEN NOT p.en_ledger AND (
        ((extract(hour FROM p.created_at AT TIME ZONE 'America/Mazatlan') >= 17
          OR extract(hour FROM p.created_at AT TIME ZONE 'America/Mazatlan') < 5)
         AND p.fecha = (p.created_at AT TIME ZONE 'UTC')::date)                       -- A
     OR (extract(hour FROM p.created_at AT TIME ZONE 'America/Mazatlan') >= 17
         AND p.fecha = (p.created_at AT TIME ZONE 'UTC')::date - 1))                  -- B
  THEN p.fecha - 1
  ELSE p.fecha END
WHERE p.dia_operativo_corregido IS NULL;

-- Registros nuevos: la app ya calcula la fecha con diaOperativo() (Mazatlan, corte 05:00)
CREATE OR REPLACE FUNCTION trg_pedidos_dia_corregido() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.dia_operativo_corregido := COALESCE(NEW.dia_operativo_corregido, NEW.fecha);
  ELSIF NEW.fecha IS DISTINCT FROM OLD.fecha THEN
    NEW.dia_operativo_corregido := NEW.fecha;
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER pedidos_dia_corregido BEFORE INSERT OR UPDATE OF fecha ON pedidos
  FOR EACH ROW EXECUTE FUNCTION trg_pedidos_dia_corregido();

-- ════════════════════════════════════════════════════════════
-- 2) Bases únicas de análisis
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION es_burger(p_nombre text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT p_nombre ILIKE '%smash%' AND p_nombre NOT ILIKE '%papas%'
$$;

-- Tasas reales de Didi (en vivo, sobre venta bruta) desde importaciones_didi.
-- retenciones = bruta − comisión − promos − ganancia_neta (ISR/IVA retenido).
CREATE OR REPLACE VIEW v_didi_tasas AS
SELECT negocio_id,
       SUM(venta_bruta) AS bruta,
       COALESCE(SUM(comision_didi) / NULLIF(SUM(venta_bruta), 0), 0.235) AS tasa_comision,
       COALESCE(SUM(costo_promos)  / NULLIF(SUM(venta_bruta), 0), 0.241) AS tasa_promos,
       COALESCE(GREATEST(SUM(venta_bruta - comision_didi - costo_promos - ganancia_neta), 0)
                / NULLIF(SUM(venta_bruta), 0), 0) AS tasa_retenciones
FROM importaciones_didi
GROUP BY negocio_id;

-- UN solo lugar para ventas: pedidos (app, WhatsApp, salón, Didi capturado) + importaciones Didi
-- de días sin pedidos Didi capturados (anti doble conteo). Excluye cancelados.
-- Didi capturado no trae desglose: se estima con las tasas reales sobre la venta bruta.
-- hora: sólo cuando el pedido se capturó en vivo (mismo día operativo, en horario de servicio).
CREATE OR REPLACE VIEW v_pedidos_base AS
WITH t AS (SELECT * FROM v_didi_tasas),
p AS (
  SELECT p.*, COALESCE(p.dia_operativo_corregido, p.fecha) AS dia,
         CASE WHEN p.canal = 'manual' THEN 'salon' ELSE p.canal END AS canal_n,
         extract(hour FROM p.created_at AT TIME ZONE 'America/Mazatlan')::int AS h_cap,
         (SELECT SUM(i.cantidad * i.precio) FROM pedido_items i WHERE i.pedido_id = p.id) AS bruta_items
  FROM pedidos p
  WHERE NOT p.cancelado
)
SELECT p.negocio_id, 'pedido'::text AS origen, p.id AS pedido_id, p.dia, p.canal_n AS canal,
       CASE WHEN dia_operativo(p.created_at) = p.dia AND (p.h_cap >= 16 OR p.h_cap < 5) THEN p.h_cap END AS hora,
       b.bruta,
       CASE WHEN p.canal_n = 'didi' THEN round(b.bruta * COALESCE(t.tasa_comision, 0.235), 2) ELSE 0 END AS comision,
       CASE WHEN p.canal_n = 'didi' THEN round(b.bruta * COALESCE(t.tasa_promos, 0.241), 2) ELSE 0 END AS promos,
       CASE WHEN p.canal_n = 'didi' THEN round(b.bruta * COALESCE(t.tasa_retenciones, 0), 2) ELSE 0 END AS retenciones,
       CASE WHEN p.canal_n = 'didi'
            THEN b.bruta - round(b.bruta * COALESCE(t.tasa_comision, 0.235), 2)
                         - round(b.bruta * COALESCE(t.tasa_promos, 0.241), 2)
                         - round(b.bruta * COALESCE(t.tasa_retenciones, 0), 2)
            ELSE b.bruta END AS neta,
       (p.canal_n = 'didi') AS desglose_estimado
FROM p
LEFT JOIN t ON t.negocio_id = p.negocio_id
CROSS JOIN LATERAL (
  SELECT CASE WHEN p.canal_n = 'didi' THEN COALESCE(p.total_bruto, NULLIF(p.bruta_items, 0), p.total)
              ELSE COALESCE(p.total, 0) END AS bruta
) b
UNION ALL
SELECT d.negocio_id, 'didi_import', NULL, d.fecha, 'didi', NULL,
       d.venta_bruta, COALESCE(d.comision_didi, 0), COALESCE(d.costo_promos, 0),
       GREATEST(d.venta_bruta - COALESCE(d.comision_didi, 0) - COALESCE(d.costo_promos, 0) - COALESCE(d.ganancia_neta, 0), 0),
       COALESCE(d.ganancia_neta, 0), false
FROM importaciones_didi d
WHERE NOT EXISTS (SELECT 1 FROM pedidos x
                  WHERE x.negocio_id = d.negocio_id AND x.canal = 'didi' AND NOT x.cancelado
                    AND COALESCE(x.dia_operativo_corregido, x.fecha) = d.fecha);

-- Partidas vendidas con su costo: consumo valorizado de la receta (Fase 2) o, si no hay,
-- respaldo con pedido_items.costo / productos.costo_insumos (marcado costo_respaldo).
CREATE OR REPLACE VIEW v_items_base AS
SELECT b.negocio_id, b.dia, b.canal, b.pedido_id, pi.id AS item_id, pi.producto_id, pr.nombre,
       pi.cantidad, pi.precio, es_burger(pr.nombre) AS burger,
       COALESCE(inv.costo, pi.cantidad * COALESCE(NULLIF(pi.costo, 0), pr.costo_insumos, 0)) AS costo,
       (inv.costo IS NULL) AS costo_respaldo
FROM v_pedidos_base b
JOIN pedido_items pi ON pi.pedido_id = b.pedido_id
LEFT JOIN productos pr ON pr.id = pi.producto_id
LEFT JOIN LATERAL (
  SELECT -SUM(m.cantidad * m.costo_unitario) AS costo
  FROM inventario_movimientos m
  WHERE m.ref_tabla = 'pedido_items' AND m.ref_id = pi.id
  HAVING count(*) > 0
) inv ON true
WHERE b.origen = 'pedido';

-- Devengo de obligaciones: cada obligación cubre su periodo (semana que termina en el vencimiento,
-- mes, quincena o bimestre); las manuales/impuestos, su día de vencimiento. Excluye canceladas
-- y compras a crédito (eso es costo de insumos, no OPEX).
CREATE OR REPLACE VIEW v_obligaciones_devengo AS
SELECT o.id, o.negocio_id, o.concepto, o.categoria, o.monto, o.fecha_vencimiento, o.origen,
  CASE WHEN g.frecuencia = 'semanal' THEN o.fecha_vencimiento - 6
       WHEN g.frecuencia = 'quincenal' AND o.periodo LIKE '%-Q2' THEN date_trunc('month', o.fecha_vencimiento)::date + 15
       WHEN g.frecuencia IN ('mensual','quincenal','bimestral') THEN date_trunc('month', o.fecha_vencimiento)::date
       ELSE o.fecha_vencimiento END AS ini,
  CASE WHEN g.frecuencia = 'semanal' THEN o.fecha_vencimiento
       WHEN g.frecuencia = 'quincenal' AND o.periodo LIKE '%-Q1' THEN date_trunc('month', o.fecha_vencimiento)::date + 14
       WHEN g.frecuencia IN ('mensual','quincenal') THEN (date_trunc('month', o.fecha_vencimiento) + interval '1 month - 1 day')::date
       WHEN g.frecuencia = 'bimestral' THEN (date_trunc('month', o.fecha_vencimiento) + interval '2 month - 1 day')::date
       ELSE o.fecha_vencimiento END AS fin
FROM obligaciones o
LEFT JOIN gastos_recurrentes g ON g.id = o.gasto_recurrente_id
WHERE o.estado <> 'cancelada' AND o.origen <> 'compra_credito';

-- OPEX devengado del periodo por categoría (incluye 'prestamo' como categoría aparte;
-- quien llama decide: los préstamos NO son OPEX)
CREATE OR REPLACE FUNCTION opex_periodo(p_negocio uuid, p_desde date, p_hasta date)
RETURNS TABLE (categoria text, monto numeric) LANGUAGE sql STABLE AS $$
  SELECT d.categoria,
         round(SUM(d.monto * (LEAST(d.fin, p_hasta) - GREATEST(d.ini, p_desde) + 1)::numeric / (d.fin - d.ini + 1)), 2)
  FROM v_obligaciones_devengo d
  WHERE d.negocio_id = p_negocio AND d.ini <= p_hasta AND d.fin >= p_desde
  GROUP BY d.categoria
$$;

-- OPEX mensual "de plantilla" (gastos fijos activos, sin préstamos), para promedios diarios
CREATE OR REPLACE FUNCTION opex_mensual_plantilla(p_negocio uuid)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(monto * CASE frecuencia WHEN 'semanal' THEN 52.0 / 12 WHEN 'quincenal' THEN 2
                                              WHEN 'bimestral' THEN 0.5 ELSE 1 END), 0)
  FROM gastos_recurrentes
  WHERE negocio_id = p_negocio AND activo AND categoria <> 'prestamo'
$$;

-- Lista de compras (misma regla que la Fase 2, ahora en un solo lugar): insumos contados,
-- bajo mínimo o con cobertura < dias_reposicion_inventario. Sugerido redondeado a 100 g/ml o pieza.
CREATE OR REPLACE FUNCTION lista_compras(p_negocio uuid)
RETURNS TABLE (insumo_id uuid, nombre text, unidad_base text, proveedor_id uuid, stock numeric,
               dias_cobertura numeric, bajo_minimo boolean, costo_promedio numeric, sugerido numeric, costo numeric)
LANGUAGE sql STABLE AS $$
  WITH cfg AS (
    SELECT COALESCE((SELECT dias_reposicion_inventario FROM configuracion_negocio WHERE negocio_id = p_negocio), 7) AS d
  ),
  base AS (
    SELECT s.*, GREATEST(COALESCE(s.consumo_diario, 0) * (SELECT d FROM cfg), s.stock_minimo) - GREATEST(s.stock, 0) AS falta
    FROM v_stock_insumos s
    WHERE s.negocio_id = p_negocio AND s.activo AND s.contado
      AND (s.bajo_minimo OR (s.dias_cobertura IS NOT NULL AND s.dias_cobertura < (SELECT d FROM cfg)))
  ),
  sug AS (
    SELECT b.*, CASE WHEN b.unidad_base = 'pza' THEN ceil(b.falta) ELSE ceil(b.falta / 100) * 100 END AS sugerido
    FROM base b WHERE b.falta > 0
  )
  SELECT insumo_id, nombre, unidad_base, proveedor_id, stock, dias_cobertura, bajo_minimo, costo_promedio,
         sugerido, round(sugerido * costo_promedio, 2)
  FROM sug
  ORDER BY dias_cobertura NULLS FIRST
$$;

-- ════════════════════════════════════════════════════════════
-- 3) Rentabilidad
-- ════════════════════════════════════════════════════════════
-- Costo de ventas del periodo: partidas (receta o respaldo) + estimado de importaciones Didi
-- (no traen productos: venta bruta × razón costo/bruta de los pedidos Didi con partidas).
CREATE OR REPLACE FUNCTION costo_ventas_periodo(p_negocio uuid, p_desde date, p_hasta date)
RETURNS TABLE (venta_neta numeric, costo numeric, costo_respaldo numeric, costo_estimado_import numeric)
LANGUAGE plpgsql STABLE AS $$
DECLARE v_ratio numeric; v_neta numeric; v_bimp numeric; v_c numeric; v_r numeric;
BEGIN
  SELECT COALESCE(SUM(b.neta), 0), COALESCE(SUM(b.bruta) FILTER (WHERE b.origen = 'didi_import'), 0)
  INTO v_neta, v_bimp
  FROM v_pedidos_base b WHERE b.negocio_id = p_negocio AND b.dia BETWEEN p_desde AND p_hasta;

  SELECT COALESCE(SUM(i.costo), 0), COALESCE(SUM(i.costo) FILTER (WHERE i.costo_respaldo), 0)
  INTO v_c, v_r
  FROM v_items_base i WHERE i.negocio_id = p_negocio AND i.dia BETWEEN p_desde AND p_hasta;

  IF v_bimp > 0 THEN
    SELECT SUM(i.costo) / NULLIF(SUM(i.cantidad * i.precio), 0) INTO v_ratio
    FROM v_items_base i WHERE i.negocio_id = p_negocio AND i.canal = 'didi';
    IF v_ratio IS NULL THEN
      SELECT SUM(i.costo) / NULLIF(SUM(i.cantidad * i.precio), 0) INTO v_ratio
      FROM v_items_base i WHERE i.negocio_id = p_negocio;
    END IF;
  END IF;

  RETURN QUERY SELECT round(v_neta, 2), round(v_c + v_bimp * COALESCE(v_ratio, 0), 2), round(v_r, 2),
                      round(v_bimp * COALESCE(v_ratio, 0), 2);
END $$;

-- Margen de contribución por producto y canal: precio neto del canal − costo (receta o respaldo).
-- Didi neto = precio_didi × (1 − comisión − promos − retenciones) con tasas reales.
CREATE OR REPLACE FUNCTION margenes_producto(p_negocio uuid, p_desde date, p_hasta date)
RETURNS TABLE (producto_id uuid, nombre text, burger boolean, tiene_receta boolean, costo numeric,
               canal text, precio numeric, precio_neto numeric, margen numeric, unidades numeric)
LANGUAGE sql STABLE AS $$
  WITH t AS (
    SELECT COALESCE((SELECT tasa_comision + tasa_promos + tasa_retenciones FROM v_didi_tasas WHERE negocio_id = p_negocio), 0.476) AS ded
  ),
  prod AS (
    SELECT p.*, vc.n_insumos > 0 AS tiene_receta,
           CASE WHEN vc.n_insumos > 0 THEN vc.costo_receta ELSE p.costo_insumos END AS costo
    FROM productos p JOIN v_costo_receta vc ON vc.producto_id = p.id
    WHERE p.negocio_id = p_negocio AND p.disponible
  ),
  u AS (
    SELECT i.producto_id, i.canal, SUM(i.cantidad) AS unidades
    FROM v_items_base i WHERE i.negocio_id = p_negocio AND i.dia BETWEEN p_desde AND p_hasta
    GROUP BY 1, 2
  )
  SELECT pr.id, pr.nombre, es_burger(pr.nombre), pr.tiene_receta, pr.costo,
         ch.canal, ch.precio, ch.neto, round(ch.neto - pr.costo, 2), COALESCE(u.unidades, 0)
  FROM prod pr
  CROSS JOIN LATERAL (VALUES
    ('whatsapp', COALESCE(pr.precio_whatsapp, pr.precio_venta), COALESCE(pr.precio_whatsapp, pr.precio_venta)),
    ('salon',    pr.precio_venta, pr.precio_venta),
    ('didi',     pr.precio_didi,  round(pr.precio_didi * (1 - (SELECT ded FROM t)), 2))
  ) AS ch(canal, precio, neto)
  LEFT JOIN u ON u.producto_id = pr.id AND u.canal = ch.canal
  WHERE ch.precio IS NOT NULL
  ORDER BY pr.orden, ch.canal
$$;

-- Resumen financiero de un periodo (todo por día operativo, sin cancelados)
CREATE OR REPLACE FUNCTION resumen_periodo(p_negocio uuid, p_desde date, p_hasta date)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v record; c record; cv record; fcr jsonb; cfg record;
  v_opex jsonb; v_opex_total numeric; v_prest numeric; v_nomina numeric; v_sueldo numeric;
  v_merma numeric; v_retiros numeric; v_corte numeric; v_canales jsonb;
  v_util numeric; v_mcb numeric; v_eq_b numeric; v_eq_p numeric;
BEGIN
  SELECT COALESCE(SUM(bruta), 0) AS bruta, COALESCE(SUM(comision), 0) AS com, COALESCE(SUM(promos), 0) AS promos,
         COALESCE(SUM(retenciones), 0) AS ret, COALESCE(SUM(neta), 0) AS neta, count(*) AS tickets,
         COALESCE(SUM(bruta) FILTER (WHERE desglose_estimado), 0) AS bruta_didi_estimada,
         count(*) FILTER (WHERE origen = 'didi_import') AS tickets_import
  INTO v FROM v_pedidos_base WHERE negocio_id = p_negocio AND dia BETWEEN p_desde AND p_hasta;

  SELECT COALESCE(SUM(cantidad) FILTER (WHERE burger), 0) AS burgers, COALESCE(SUM(cantidad), 0) AS unidades
  INTO c FROM v_items_base WHERE negocio_id = p_negocio AND dia BETWEEN p_desde AND p_hasta;

  SELECT * INTO cv FROM costo_ventas_periodo(p_negocio, p_desde, p_hasta);

  SELECT COALESCE(jsonb_object_agg(canal, jsonb_build_object('tickets', n, 'bruta', b, 'neta', nt)), '{}') INTO v_canales
  FROM (SELECT canal, count(*) n, SUM(bruta) b, SUM(neta) nt FROM v_pedidos_base
        WHERE negocio_id = p_negocio AND dia BETWEEN p_desde AND p_hasta GROUP BY canal) x;

  SELECT COALESCE(jsonb_object_agg(categoria, monto) FILTER (WHERE categoria <> 'prestamo'), '{}'),
         COALESCE(SUM(monto) FILTER (WHERE categoria <> 'prestamo'), 0),
         COALESCE(SUM(monto) FILTER (WHERE categoria = 'prestamo'), 0),
         COALESCE(SUM(monto) FILTER (WHERE categoria = 'nomina'), 0),
         COALESCE(SUM(monto) FILTER (WHERE categoria = 'sueldo_dueno'), 0)
  INTO v_opex, v_opex_total, v_prest, v_nomina, v_sueldo
  FROM opex_periodo(p_negocio, p_desde, p_hasta);

  SELECT COALESCE(-SUM(cantidad * costo_unitario), 0) INTO v_merma FROM inventario_movimientos
  WHERE negocio_id = p_negocio AND tipo IN ('merma','ajuste_conteo') AND dia_operativo BETWEEN p_desde AND p_hasta;

  SELECT COALESCE(-SUM(monto) FILTER (WHERE tipo = 'retiro_dueno'), 0),
         COALESCE(SUM(monto) FILTER (WHERE tipo = 'ajuste_corte'), 0)
  INTO v_retiros, v_corte FROM movimientos
  WHERE negocio_id = p_negocio AND dia_operativo BETWEEN p_desde AND p_hasta;

  SELECT * INTO cfg FROM configuracion_negocio WHERE negocio_id = p_negocio;
  fcr := food_cost(p_negocio, p_desde, p_hasta);

  v_util := v.neta - cv.costo - v_opex_total;
  v_mcb  := CASE WHEN c.burgers > 0 THEN (v.neta - cv.costo) / c.burgers END;
  v_eq_b := CASE WHEN v_mcb > 0 AND v_opex_total > 0 THEN ceil(v_opex_total / v_mcb) END;
  v_eq_p := CASE WHEN v_eq_b IS NOT NULL THEN round(v_eq_b * v.neta / c.burgers, 2) END;

  RETURN jsonb_build_object(
    'desde', p_desde, 'hasta', p_hasta,
    'venta_bruta', round(v.bruta, 2), 'comision_didi', round(v.com, 2), 'promos_didi', round(v.promos, 2),
    'retenciones_didi', round(v.ret, 2), 'venta_neta', round(v.neta, 2),
    'bruta_didi_estimada', round(v.bruta_didi_estimada, 2),
    'tickets', v.tickets, 'tickets_import', v.tickets_import,
    'ticket_promedio', CASE WHEN v.tickets > 0 THEN round(v.neta / v.tickets, 2) END,
    'burgers', c.burgers, 'unidades', c.unidades, 'canales', v_canales,
    'costo_ventas', cv.costo, 'costo_respaldo', cv.costo_respaldo, 'costo_estimado_import', cv.costo_estimado_import,
    'margen_bruto', round(v.neta - cv.costo, 2),
    'food_cost', CASE WHEN v.neta > 0 THEN round(cv.costo / v.neta, 4) END,
    'food_cost_real', CASE WHEN NOT (fcr->>'estimado')::boolean THEN fcr->'fc_real' END,
    'meta_food_cost', cfg.meta_food_cost,
    'opex', v_opex, 'opex_total', v_opex_total,
    'utilidad_operativa', round(v_util, 2),
    'prestamos', v_prest,
    'despues_prestamos', round(v_util - v_prest, 2),
    'prime_cost', CASE WHEN v.neta > 0 THEN round((cv.costo + v_nomina + v_sueldo) / v.neta, 4) END,
    'margen_contribucion_burger', round(v_mcb, 2),
    'equilibrio_burgers', v_eq_b, 'equilibrio_pesos', v_eq_p,
    'margen_seguridad', CASE WHEN v_eq_p IS NOT NULL AND v.neta > 0 THEN round((v.neta - v_eq_p) / v.neta, 4) END,
    'reserva_impuestos', round(v.neta * cfg.tasa_reserva_impuestos, 2),
    'merma', round(v_merma, 2), 'merma_pct', CASE WHEN v.neta > 0 THEN round(v_merma / v.neta, 4) END,
    'retiros', round(v_retiros, 2), 'diferencias_corte', round(v_corte, 2),
    'compras', (SELECT COALESCE(SUM(monto), 0) FROM compras_insumos
                WHERE negocio_id = p_negocio AND fecha BETWEEN p_desde AND p_hasta)
  );
END $$;

-- ════════════════════════════════════════════════════════════
-- 4) Dinero comprometido
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION dinero_comprometido(p_negocio uuid, p_horizonte_dias int DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_hoy date := dia_operativo(now());
  v_mes date := date_trunc('month', dia_operativo(now()))::date;
  v_total numeric; v_didi numeric; v_obl numeric; v_repo numeric; v_imp numeric; v_imp_pagado numeric;
  v_lineas jsonb; v_repo_lineas jsonb; v_opex_sem numeric; v_libre numeric; v_comp numeric; v_tasa numeric;
  v_venta_mes numeric; v_sin_saldos boolean;
BEGIN
  PERFORM generar_obligaciones(p_negocio, v_hoy + p_horizonte_dias);

  SELECT COALESCE(SUM(saldo) FILTER (WHERE clave IN ('caja','banco','terminal')), 0),
         COALESCE(SUM(saldo) FILTER (WHERE clave = 'didi'), 0)
  INTO v_total, v_didi FROM v_saldos_cuentas WHERE negocio_id = p_negocio;
  v_sin_saldos := NOT EXISTS (SELECT 1 FROM movimientos WHERE negocio_id = p_negocio AND tipo = 'saldo_inicial');

  -- a) obligaciones pendientes (incluye vencidas) hasta hoy + horizonte
  SELECT COALESCE(SUM(monto - monto_pagado), 0),
         COALESCE(jsonb_agg(jsonb_build_object('tipo', 'obligacion', 'concepto', concepto, 'categoria', categoria,
                   'vence', fecha_vencimiento, 'monto', monto - monto_pagado, 'vencida', fecha_vencimiento < v_hoy)
                   ORDER BY fecha_vencimiento, concepto), '[]')
  INTO v_obl, v_lineas
  FROM obligaciones
  WHERE negocio_id = p_negocio AND estado IN ('pendiente','parcial')
    AND fecha_vencimiento <= v_hoy + p_horizonte_dias;

  -- b) reposición de inventario a dias_reposicion_inventario de cobertura
  SELECT COALESCE(SUM(costo), 0) INTO v_repo FROM lista_compras(p_negocio);

  -- c) reserva de impuestos del mes no pagada: venta neta del mes × tasa − impuestos pagados en el mes
  SELECT COALESCE(tasa_reserva_impuestos, 0.02) INTO v_tasa FROM configuracion_negocio WHERE negocio_id = p_negocio;
  SELECT COALESCE(SUM(neta), 0) INTO v_venta_mes FROM v_pedidos_base
  WHERE negocio_id = p_negocio AND dia BETWEEN v_mes AND v_hoy;
  SELECT COALESCE(SUM(po.monto), 0) INTO v_imp_pagado
  FROM pagos_obligacion po JOIN obligaciones o ON o.id = po.obligacion_id
  WHERE po.negocio_id = p_negocio AND (o.origen = 'impuesto' OR o.categoria = 'impuesto')
    AND dia_operativo(po.fecha) >= v_mes;
  v_imp := GREATEST(round(v_venta_mes * COALESCE(v_tasa, 0.02) - v_imp_pagado, 2), 0);

  v_comp  := round(v_obl + v_repo + v_imp, 2);
  v_libre := round(v_total - v_comp, 2);
  v_opex_sem := round(opex_mensual_plantilla(p_negocio) * 7 / 30.4, 2);

  IF v_repo > 0 THEN
    v_lineas := v_lineas || jsonb_build_array(jsonb_build_object('tipo', 'reposicion', 'concepto', 'Reposición de inventario',
                 'monto', v_repo, 'vencida', false));
  END IF;
  IF v_imp > 0 THEN
    v_lineas := v_lineas || jsonb_build_array(jsonb_build_object('tipo', 'impuestos',
                 'concepto', 'Reserva de impuestos del mes (' || round(COALESCE(v_tasa, 0.02) * 100, 1) || '% de ventas)',
                 'monto', v_imp, 'vencida', false));
  END IF;

  RETURN jsonb_build_object(
    'hoy', v_hoy, 'horizonte_dias', p_horizonte_dias,
    'dinero_total', v_total, 'por_cobrar_didi', v_didi,
    'obligaciones', v_obl, 'reposicion', v_repo, 'impuestos', v_imp, 'venta_mes', v_venta_mes,
    'comprometido', v_comp, 'dinero_libre', v_libre,
    'opex_semanal', v_opex_sem,
    'semaforo', CASE WHEN v_libre >= v_opex_sem THEN 'verde' WHEN v_libre >= 0 THEN 'amarillo' ELSE 'rojo' END,
    'sin_saldos', v_sin_saldos,
    'vence_7_dias', (SELECT COALESCE(SUM(monto - monto_pagado), 0) FROM obligaciones
                     WHERE negocio_id = p_negocio AND estado IN ('pendiente','parcial') AND fecha_vencimiento <= v_hoy + 7),
    'lineas', v_lineas
  );
END $$;

-- ════════════════════════════════════════════════════════════
-- 5) Cashflow proyectado por semana (semana 1 = mañana a +7 días)
-- ════════════════════════════════════════════════════════════
-- Entradas: promedio de venta neta por día de semana de las últimas 4 semanas con ventas
-- (si el dueño dejó de capturar, la ventana termina en el último día con ventas), lunes = 0.
-- Directo (efectivo/terminal) entra el mismo día; Didi entra el dia_pago_didi de la semana
-- siguiente a la venta; el Didi por cobrar actual entra en la primera fecha de pago.
-- Salidas: compras promedio (sin las de crédito: ésas ya son obligaciones), obligaciones
-- pendientes por vencimiento (vencidas → semana 1; una sola vez cada una), sueldo del dueño
-- y retiros promedio, por separado.
CREATE OR REPLACE FUNCTION cashflow_proyectado(p_negocio uuid, p_semanas int DEFAULT 8, p_factor_ventas numeric DEFAULT 1)
RETURNS TABLE (semana int, desde date, hasta date, saldo_inicial numeric, entradas_directas numeric,
               entradas_didi numeric, compras numeric, obligaciones numeric, sueldo_dueno numeric,
               retiros numeric, saldo_final numeric, ventana_desde date, ventana_hasta date)
LANGUAGE plpgsql AS $$
DECLARE
  v_hoy date := dia_operativo(now());
  v_ini date := dia_operativo(now()) + 1;
  v_fin date := dia_operativo(now()) + 7 * p_semanas;
  v_ref date; v_saldo numeric; v_didi_pend numeric; v_pago int; v_primer_pago date;
  v_compras_sem numeric; v_retiros_sem numeric;
BEGIN
  PERFORM generar_obligaciones(p_negocio, v_fin);
  SELECT max(dia) INTO v_ref FROM v_pedidos_base WHERE negocio_id = p_negocio AND dia <= v_hoy;
  v_ref := COALESCE(v_ref, v_hoy);
  SELECT COALESCE(SUM(saldo) FILTER (WHERE clave IN ('caja','banco','terminal')), 0),
         COALESCE(SUM(saldo) FILTER (WHERE clave = 'didi'), 0)
  INTO v_saldo, v_didi_pend FROM v_saldos_cuentas WHERE negocio_id = p_negocio;
  SELECT COALESCE(dia_pago_didi, 1) INTO v_pago FROM configuracion_negocio WHERE negocio_id = p_negocio;
  v_pago := COALESCE(v_pago, 1);
  v_primer_pago := v_ini + ((v_pago - extract(isodow FROM v_ini)::int + 7) % 7);

  SELECT COALESCE(SUM(monto), 0) / 4.0 INTO v_compras_sem FROM compras_insumos
  WHERE negocio_id = p_negocio AND fecha BETWEEN v_ref - 27 AND v_ref AND metodo_pago IS DISTINCT FROM 'credito';
  SELECT COALESCE(-SUM(monto), 0) / 4.0 INTO v_retiros_sem FROM movimientos
  WHERE negocio_id = p_negocio AND tipo = 'retiro_dueno' AND dia_operativo BETWEEN v_ref - 27 AND v_ref;

  RETURN QUERY
  WITH prom AS (
    SELECT extract(isodow FROM g)::int AS dow,
           COALESCE(SUM(b.neta) FILTER (WHERE b.canal <> 'didi'), 0) / 4.0 AS directo,
           COALESCE(SUM(b.neta) FILTER (WHERE b.canal = 'didi'), 0) / 4.0 AS didi
    FROM generate_series(v_ref - 27, v_ref, interval '1 day') g
    LEFT JOIN v_pedidos_base b ON b.negocio_id = p_negocio AND b.dia = g::date
    GROUP BY 1
  ),
  dias AS (
    SELECT g::date AS dia, ((g::date - v_ini) / 7) + 1 AS sem,
           CASE WHEN extract(isodow FROM g) = 1 THEN 0 ELSE pr.directo * p_factor_ventas END AS directo,
           CASE WHEN extract(isodow FROM g) = 1 THEN 0 ELSE pr.didi * p_factor_ventas END AS didi_venta,
           -- Didi paga el dia_pago_didi de la semana siguiente a la venta
           date_trunc('week', g)::date + 7 + (v_pago - 1) AS dia_cobro
    FROM generate_series(v_ini, v_fin, interval '1 day') g
    JOIN prom pr ON pr.dow = extract(isodow FROM g)::int
  ),
  semanas AS (
    SELECT s AS sem, v_ini + 7 * (s - 1) AS d1, v_ini + 7 * s - 1 AS d2 FROM generate_series(1, p_semanas) s
  ),
  obl AS (
    SELECT ((GREATEST(o.fecha_vencimiento, v_ini) - v_ini) / 7) + 1 AS sem,
           SUM(o.monto - o.monto_pagado) FILTER (WHERE o.categoria <> 'sueldo_dueno') AS obl,
           SUM(o.monto - o.monto_pagado) FILTER (WHERE o.categoria = 'sueldo_dueno') AS sueldo
    FROM obligaciones o
    WHERE o.negocio_id = p_negocio AND o.estado IN ('pendiente','parcial') AND o.fecha_vencimiento <= v_fin
    GROUP BY 1
  ),
  flujo AS (
    SELECT s.sem, s.d1, s.d2,
           round(COALESCE((SELECT SUM(d.directo) FROM dias d WHERE d.sem = s.sem), 0), 2) AS e_dir,
           round(COALESCE((SELECT SUM(d.didi_venta) FROM dias d WHERE d.dia_cobro BETWEEN s.d1 AND s.d2), 0)
                 + CASE WHEN v_primer_pago BETWEEN s.d1 AND s.d2 THEN v_didi_pend ELSE 0 END, 2) AS e_didi,
           round(v_compras_sem, 2) AS comp,
           round(COALESCE(o.obl, 0), 2) AS obl,
           round(COALESCE(o.sueldo, 0), 2) AS sueldo,
           round(v_retiros_sem, 2) AS ret
    FROM semanas s LEFT JOIN obl o ON o.sem = s.sem
  ),
  acum AS (
    SELECT f.*, v_saldo + SUM(f.e_dir + f.e_didi - f.comp - f.obl - f.sueldo - f.ret) OVER (ORDER BY f.sem) AS fin_
    FROM flujo f
  )
  SELECT a.sem::int, a.d1, a.d2, round(a.fin_ - (a.e_dir + a.e_didi - a.comp - a.obl - a.sueldo - a.ret), 2),
         a.e_dir, a.e_didi, a.comp, a.obl, a.sueldo, a.ret, round(a.fin_, 2), v_ref - 27, v_ref
  FROM acum a ORDER BY a.sem;
END $$;

-- ════════════════════════════════════════════════════════════
-- 6) Dashboard: todo agregado en una llamada
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION dashboard(p_negocio uuid, p_desde date, p_hasta date)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_len int := p_hasta - p_desde + 1;
  v_hoy date := dia_operativo(now());
  v_mes date := date_trunc('month', dia_operativo(now()))::date;
  v_fin_mes date := (date_trunc('month', dia_operativo(now())) + interval '1 month - 1 day')::date;
  r jsonb; v_inv jsonb; v_ef jsonb; v_mes_j jsonb; v_valor numeric; v_cv numeric;
  v_gfd numeric; v_compras_d numeric; v_disp numeric; v_didi numeric;
BEGIN
  r := jsonb_build_object(
    'actual',   resumen_periodo(p_negocio, p_desde, p_hasta),
    'anterior', resumen_periodo(p_negocio, p_desde - v_len, p_desde - 1),
    'diario', (SELECT COALESCE(jsonb_agg(x ORDER BY x.dia), '[]') FROM (
       SELECT dia, round(SUM(neta) FILTER (WHERE canal = 'whatsapp'), 2) AS whatsapp,
              round(SUM(neta) FILTER (WHERE canal = 'salon'), 2) AS salon,
              round(SUM(neta) FILTER (WHERE canal = 'didi'), 2) AS didi
       FROM v_pedidos_base WHERE negocio_id = p_negocio AND dia BETWEEN p_desde AND p_hasta GROUP BY dia) x),
    'heatmap', (SELECT COALESCE(jsonb_agg(x), '[]') FROM (
       SELECT extract(isodow FROM dia)::int AS dow, hora, count(*) AS tickets
       FROM v_pedidos_base WHERE negocio_id = p_negocio AND dia BETWEEN p_desde AND p_hasta AND hora IS NOT NULL
       GROUP BY 1, 2) x),
    'heatmap_cobertura', (SELECT jsonb_build_object('con_hora', count(*) FILTER (WHERE hora IS NOT NULL), 'total', count(*))
       FROM v_pedidos_base WHERE negocio_id = p_negocio AND dia BETWEEN p_desde AND p_hasta),
    'productos', (SELECT COALESCE(jsonb_agg(x ORDER BY x.unidades DESC), '[]') FROM (
       SELECT nombre, SUM(cantidad) AS unidades, round(SUM(cantidad * precio), 2) AS venta, round(SUM(costo), 2) AS costo,
              bool_or(costo_respaldo) AS respaldo
       FROM v_items_base WHERE negocio_id = p_negocio AND dia BETWEEN p_desde AND p_hasta GROUP BY nombre) x),
    'margenes', (SELECT COALESCE(jsonb_agg(to_jsonb(m)), '[]') FROM margenes_producto(p_negocio, p_desde, p_hasta) m),
    'tasas_didi', (SELECT to_jsonb(t) FROM v_didi_tasas t WHERE t.negocio_id = p_negocio),
    -- Venta promedio por día de semana (últimas 8 semanas hasta p_hasta), para valles y picos
    'ventas_dow', (SELECT COALESCE(jsonb_agg(x ORDER BY x.dow), '[]') FROM (
       SELECT extract(isodow FROM g)::int AS dow, round(COALESCE(SUM(b.neta), 0) / 8.0, 2) AS promedio
       FROM generate_series(p_hasta - 55, p_hasta, interval '1 day') g
       LEFT JOIN v_pedidos_base b ON b.negocio_id = p_negocio AND b.dia = g::date
       GROUP BY 1) x),
    -- Food cost semanal (8 semanas ISO hasta la semana de p_hasta)
    'fc_semanal', (SELECT COALESCE(jsonb_agg(x ORDER BY x.semana), '[]') FROM (
       SELECT s::date AS semana, cv.venta_neta, cv.costo,
              CASE WHEN cv.venta_neta > 0 THEN round(cv.costo / cv.venta_neta, 4) END AS fc
       FROM generate_series(date_trunc('week', p_hasta) - interval '7 weeks', date_trunc('week', p_hasta), interval '1 week') s
       CROSS JOIN LATERAL costo_ventas_periodo(p_negocio, s::date, s::date + 6) cv) x)
  );

  -- Inventario
  SELECT COALESCE(SUM(GREATEST(valor, 0)) FILTER (WHERE contado), 0) INTO v_valor
  FROM v_stock_insumos WHERE negocio_id = p_negocio AND activo;
  v_cv := (r->'actual'->>'costo_ventas')::numeric;
  v_inv := jsonb_build_object(
    'insumos', (SELECT count(*) FROM insumos WHERE negocio_id = p_negocio AND activo),
    'contados', (SELECT count(*) FROM v_stock_insumos WHERE negocio_id = p_negocio AND activo AND contado),
    'productos_sin_receta', (SELECT count(*) FROM v_costo_receta WHERE negocio_id = p_negocio AND disponible AND n_insumos = 0),
    'valor', v_valor,
    'dias_inventario', CASE WHEN v_cv > 0 AND v_valor > 0 THEN round(v_valor / (v_cv / v_len), 1) END,
    'rotacion', CASE WHEN v_valor > 0 AND v_cv > 0 THEN round(v_cv / v_valor, 2) END,
    'merma_top', (SELECT COALESCE(jsonb_agg(x ORDER BY x.valor DESC), '[]') FROM (
       SELECT i.nombre, round(-SUM(m.cantidad * m.costo_unitario), 2) AS valor
       FROM inventario_movimientos m JOIN insumos i ON i.id = m.insumo_id
       WHERE m.negocio_id = p_negocio AND m.tipo IN ('merma','ajuste_conteo') AND m.dia_operativo BETWEEN p_desde AND p_hasta
       GROUP BY i.nombre HAVING -SUM(m.cantidad * m.costo_unitario) > 0 ORDER BY 2 DESC LIMIT 3) x),
    'cobertura_baja', (SELECT COALESCE(jsonb_agg(jsonb_build_object('nombre', nombre, 'dias', dias_cobertura)), '[]')
       FROM v_stock_insumos WHERE negocio_id = p_negocio AND activo AND contado AND dias_cobertura < 2),
    -- Insumos cuyo último costo de compra subió > 5% vs su costo anterior
    'insumos_suben', (SELECT COALESCE(jsonb_agg(x ORDER BY x.pct DESC), '[]') FROM (
       SELECT i.nombre, ult.cu AS ahora, ant.cu AS antes, round(ult.cu / ant.cu - 1, 4) AS pct
       FROM insumos i
       JOIN LATERAL (SELECT m.costo_unitario AS cu, m.fecha FROM inventario_movimientos m
                     WHERE m.insumo_id = i.id AND m.tipo = 'compra' AND m.cantidad > 0
                     ORDER BY m.fecha DESC LIMIT 1) ult ON true
       JOIN LATERAL (SELECT AVG(m.costo_unitario) AS cu FROM inventario_movimientos m
                     WHERE m.insumo_id = i.id AND m.tipo IN ('compra','inicial') AND m.cantidad > 0 AND m.fecha < ult.fecha) ant ON true
       WHERE i.negocio_id = p_negocio AND i.activo AND ant.cu > 0 AND ult.cu > ant.cu * 1.05
       LIMIT 5) x)
  );

  -- Efectivo
  SELECT COALESCE(SUM(saldo) FILTER (WHERE clave IN ('caja','banco','terminal')), 0),
         COALESCE(SUM(saldo) FILTER (WHERE clave = 'didi'), 0)
  INTO v_disp, v_didi FROM v_saldos_cuentas WHERE negocio_id = p_negocio;
  v_gfd := round(opex_mensual_plantilla(p_negocio) / 30.4, 2);
  SELECT round(COALESCE(SUM(monto), 0) / 28.0, 2) INTO v_compras_d FROM compras_insumos
  WHERE negocio_id = p_negocio AND fecha BETWEEN v_hoy - 27 AND v_hoy;
  v_ef := jsonb_build_object(
    'cuentas', (SELECT COALESCE(jsonb_agg(jsonb_build_object('clave', clave, 'nombre', nombre, 'saldo', saldo) ORDER BY orden), '[]')
                FROM v_saldos_cuentas WHERE negocio_id = p_negocio),
    'disponible', v_disp, 'por_cobrar_didi', v_didi,
    'sin_saldos', NOT EXISTS (SELECT 1 FROM movimientos WHERE negocio_id = p_negocio AND tipo = 'saldo_inicial'),
    'gasto_fijo_diario', v_gfd, 'compras_diarias', v_compras_d,
    'runway_dias', CASE WHEN v_gfd + v_compras_d > 0 THEN round(v_disp / (v_gfd + v_compras_d), 1) END,
    'faltantes_7_dias', (SELECT COALESCE(-SUM(monto), 0) FROM movimientos
                         WHERE negocio_id = p_negocio AND tipo = 'ajuste_corte' AND monto < 0 AND dia_operativo > v_hoy - 7),
    'hay_gastos', EXISTS (SELECT 1 FROM gastos_recurrentes WHERE negocio_id = p_negocio AND activo)
  );

  -- Mes en curso, para "¿voy arriba del punto de equilibrio?"
  v_mes_j := resumen_periodo(p_negocio, v_mes, v_hoy);
  v_mes_j := jsonb_build_object(
    'desde', v_mes, 'hasta', v_hoy, 'fin_mes', v_fin_mes,
    'venta_neta', v_mes_j->'venta_neta', 'burgers', v_mes_j->'burgers',
    'margen_contribucion_burger', v_mes_j->'margen_contribucion_burger',
    'opex_mes', (SELECT COALESCE(SUM(monto), 0) FROM opex_periodo(p_negocio, v_mes, v_fin_mes) WHERE categoria <> 'prestamo'),
    'dias_abiertos_restantes', (SELECT count(*) FROM generate_series(v_hoy + 1, v_fin_mes, interval '1 day') g
                                WHERE extract(isodow FROM g) <> 1),
    'dias_transcurridos', v_hoy - v_mes + 1, 'dias_mes', v_fin_mes - v_mes + 1
  );

  RETURN r || jsonb_build_object('inventario', v_inv, 'efectivo', v_ef, 'mes', v_mes_j, 'hoy', v_hoy);
END $$;

-- ── Permisos ──
GRANT SELECT ON v_didi_tasas, v_pedidos_base, v_items_base, v_obligaciones_devengo TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;
