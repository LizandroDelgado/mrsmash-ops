-- ============================================================
-- MR. SMASH ERP · Migración 07: panel de precios y costos
-- Aditiva: ADD COLUMN, CREATE TABLE, CREATE OR REPLACE. Nada de DROP.
-- Principios:
--   1) El histórico NO se reescribe: pedido_items guarda precio y costo de cada venta.
--      Todo lo de aquí aplica sólo hacia adelante (triggers BEFORE INSERT / sobre catálogos).
--   2) Una sola fuente de costo: la receta. productos.costo_insumos es derivado y se sincroniza
--      solo; únicamente los productos SIN receta lo conservan editable a mano.
--   3) Todo cambio de precio o costo queda en historial (qué, antes, después, cuándo, motivo).
-- ============================================================

-- ── 1) Catálogo: categoría y precio del local ─────────────────
-- (supabase/add_categoria_productos.sql, pendiente desde la Fase 1)
ALTER TABLE productos ADD COLUMN IF NOT EXISTS categoria text DEFAULT 'burger';
UPDATE productos SET categoria = 'burger'   WHERE (nombre ILIKE '%smash%' OR nombre ILIKE '%bacon%' OR nombre ILIKE '%doble%')
  AND nombre NOT ILIKE '%papas%' AND nombre NOT ILIKE '%malteada%' AND categoria IS DISTINCT FROM 'burger';
UPDATE productos SET categoria = 'malteada' WHERE nombre ILIKE '%malteada%';
UPDATE productos SET categoria = 'papas'    WHERE nombre ILIKE '%papas%';
UPDATE productos SET categoria = 'bebida'   WHERE nombre ILIKE '%refresco%';

-- Local (canal salon) no tenía precio propio: la app cobraba el de WhatsApp. Arranca igual a WhatsApp.
ALTER TABLE productos ADD COLUMN IF NOT EXISTS precio_salon numeric(10,2);
UPDATE productos SET precio_salon = COALESCE(precio_whatsapp, precio_venta) WHERE precio_salon IS NULL;
-- precio_didi_neto  = precio Didi − comisión − promos            → margen y utilidad
-- precio_didi_cobro = precio Didi − comisión − promos − retenciones → efectivo (Didi por cobrar)
ALTER TABLE productos ADD COLUMN IF NOT EXISTS precio_didi_cobro numeric(10,2);

-- ── 2) Parámetros de Didi y meta de margen ───────────────────
ALTER TABLE configuracion_negocio ADD COLUMN IF NOT EXISTS pct_comision_didi numeric(6,4);
ALTER TABLE configuracion_negocio ADD COLUMN IF NOT EXISTS pct_promos_didi   numeric(6,4);
ALTER TABLE configuracion_negocio ADD COLUMN IF NOT EXISTS meta_margen_minimo_pct numeric(5,4) NOT NULL DEFAULT 0.55;
-- Retenciones (ISR/IVA que Didi retiene): anticipo de impuestos, NO costo del producto.
-- Se usan sólo para el efectivo (lo que entra a Didi por cobrar y el depósito esperado),
-- nunca para margen ni utilidad.
ALTER TABLE configuracion_negocio ADD COLUMN IF NOT EXISTS pct_retenciones_didi numeric(6,4);
-- Prellenado con las tasas reales históricas: Σ comisión / Σ venta bruta y Σ promos / Σ venta bruta
UPDATE configuracion_negocio c
SET pct_comision_didi = COALESCE(c.pct_comision_didi, round(t.com, 4)),
    pct_promos_didi = COALESCE(c.pct_promos_didi, round(t.pro, 4)),
    pct_retenciones_didi = COALESCE(c.pct_retenciones_didi, round(t.ret, 4))
FROM (SELECT negocio_id, SUM(comision_didi) / NULLIF(SUM(venta_bruta), 0) AS com,
             SUM(costo_promos) / NULLIF(SUM(venta_bruta), 0) AS pro,
             GREATEST(SUM(venta_bruta - comision_didi - costo_promos - ganancia_neta), 0) / NULLIF(SUM(venta_bruta), 0) AS ret
      FROM importaciones_didi GROUP BY negocio_id) t
WHERE t.negocio_id = c.negocio_id;

-- Deducción Didi (comisión + promos) configurada; 0 si aún no se captura
CREATE OR REPLACE FUNCTION pct_deduccion_didi(p_negocio uuid) RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT COALESCE(pct_comision_didi, 0) + COALESCE(pct_promos_didi, 0)
                   FROM configuracion_negocio WHERE negocio_id = p_negocio), 0)
$$;

-- Retenciones de Didi configuradas (sólo para efectivo)
CREATE OR REPLACE FUNCTION pct_retenciones_didi(p_negocio uuid) RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT pct_retenciones_didi FROM configuracion_negocio WHERE negocio_id = p_negocio), 0)
$$;

-- ── 3) Historial ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS historial_precios (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  negocio_id     uuid NOT NULL REFERENCES negocios(id),
  producto_id    uuid NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  campo          text NOT NULL,            -- precio_whatsapp | precio_didi | precio_salon | precio_venta | costo_insumos
  valor_anterior numeric(12,2),
  valor_nuevo    numeric(12,2),
  motivo         text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS historial_precios_idx ON historial_precios (negocio_id, created_at DESC);

CREATE TABLE IF NOT EXISTS historial_costos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  negocio_id     uuid NOT NULL REFERENCES negocios(id),
  insumo_id      uuid NOT NULL REFERENCES insumos(id) ON DELETE CASCADE,
  costo_anterior numeric(14,6),            -- por unidad_base
  costo_nuevo    numeric(14,6),
  origen         text NOT NULL CHECK (origen IN ('manual','compra')),
  motivo         text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS historial_costos_idx ON historial_costos (negocio_id, created_at DESC);
CREATE INDEX IF NOT EXISTS historial_costos_insumo_idx ON historial_costos (insumo_id, created_at);

-- ── 4) Productos: neto Didi, local por default y costo derivado de la receta ──
CREATE OR REPLACE FUNCTION costo_receta_producto(p_producto uuid) RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT round(SUM(r.cantidad * i.costo_promedio), 2)
  FROM recetas r JOIN insumos i ON i.id = r.insumo_id
  WHERE r.producto_id = p_producto
$$;

CREATE OR REPLACE FUNCTION trg_productos_precios() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_costo numeric;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.precio_salon := COALESCE(NEW.precio_salon, NEW.precio_whatsapp, NEW.precio_venta);
  END IF;
  -- Neto Didi = precio Didi × (1 − comisión − promos) de configuracion_negocio
  NEW.precio_didi_neto := CASE WHEN NEW.precio_didi IS NULL THEN NULL
                               ELSE round(NEW.precio_didi * (1 - pct_deduccion_didi(NEW.negocio_id)), 2) END;
  NEW.precio_didi_cobro := CASE WHEN NEW.precio_didi IS NULL THEN NULL
                                ELSE round(NEW.precio_didi * (1 - pct_deduccion_didi(NEW.negocio_id) - pct_retenciones_didi(NEW.negocio_id)), 2) END;
  -- Con receta, el costo lo manda la receta (no se edita a mano)
  v_costo := costo_receta_producto(NEW.id);
  IF v_costo IS NOT NULL THEN
    NEW.costo_insumos := v_costo;
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER productos_precios BEFORE INSERT OR UPDATE ON productos
  FOR EACH ROW EXECUTE FUNCTION trg_productos_precios();

-- Historial de precios (y del costo manual de productos sin receta)
CREATE OR REPLACE FUNCTION trg_productos_historial() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_motivo text := NULLIF(current_setting('mrsmash.motivo', true), '');
BEGIN
  INSERT INTO historial_precios (negocio_id, producto_id, campo, valor_anterior, valor_nuevo, motivo)
  SELECT NEW.negocio_id, NEW.id, c.campo, c.antes, c.despues, v_motivo
  FROM (VALUES
    ('precio_whatsapp', OLD.precio_whatsapp, NEW.precio_whatsapp),
    ('precio_didi',     OLD.precio_didi,     NEW.precio_didi),
    ('precio_salon',    OLD.precio_salon,    NEW.precio_salon),
    ('precio_venta',    OLD.precio_venta,    NEW.precio_venta),
    ('costo_insumos',   CASE WHEN costo_receta_producto(NEW.id) IS NULL THEN OLD.costo_insumos END,
                        CASE WHEN costo_receta_producto(NEW.id) IS NULL THEN NEW.costo_insumos END)
  ) AS c(campo, antes, despues)
  WHERE c.antes IS DISTINCT FROM c.despues;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER productos_historial AFTER UPDATE ON productos
  FOR EACH ROW EXECUTE FUNCTION trg_productos_historial();

-- Re-sincroniza costo_insumos (el BEFORE trigger lo recalcula desde la receta)
CREATE OR REPLACE FUNCTION sincronizar_costo_productos(p_productos uuid[]) RETURNS void
LANGUAGE sql AS $$
  UPDATE productos p SET costo_insumos = c.costo
  FROM (SELECT x AS id, costo_receta_producto(x) AS costo FROM unnest(p_productos) x) c
  WHERE p.id = c.id AND c.costo IS NOT NULL AND p.costo_insumos IS DISTINCT FROM c.costo
$$;

CREATE OR REPLACE FUNCTION trg_recetas_sync() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM sincronizar_costo_productos(ARRAY[COALESCE(NEW.producto_id, OLD.producto_id)]);
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE OR REPLACE TRIGGER recetas_sync AFTER INSERT OR UPDATE OR DELETE ON recetas
  FOR EACH ROW EXECUTE FUNCTION trg_recetas_sync();

-- Cambio de costo de un insumo: historial + productos que lo usan
CREATE OR REPLACE FUNCTION trg_insumos_costo() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_origen text := COALESCE(NULLIF(current_setting('mrsmash.origen_costo', true), ''), 'compra');
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.costo_promedio > 0 THEN
      INSERT INTO historial_costos (negocio_id, insumo_id, costo_anterior, costo_nuevo, origen, motivo)
      VALUES (NEW.negocio_id, NEW.id, NULL, NEW.costo_promedio, 'manual', COALESCE(NULLIF(current_setting('mrsmash.motivo', true), ''), 'Alta de insumo'));
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.costo_promedio IS DISTINCT FROM OLD.costo_promedio THEN
    INSERT INTO historial_costos (negocio_id, insumo_id, costo_anterior, costo_nuevo, origen, motivo)
    VALUES (NEW.negocio_id, NEW.id, OLD.costo_promedio, NEW.costo_promedio, v_origen,
            COALESCE(NULLIF(current_setting('mrsmash.motivo', true), ''),
                     CASE WHEN v_origen = 'compra' THEN 'Costo promedio por compra' END));
    PERFORM sincronizar_costo_productos(ARRAY(SELECT DISTINCT producto_id FROM recetas WHERE insumo_id = NEW.id));
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER insumos_costo AFTER INSERT OR UPDATE OF costo_promedio ON insumos
  FOR EACH ROW EXECUTE FUNCTION trg_insumos_costo();

-- El kardex marca el origen del cambio de promedio (compra o carga inicial/arranque = manual)
CREATE OR REPLACE FUNCTION trg_inv_mov_before() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_cp    numeric;
  v_stock numeric;
  v_nuevo numeric;
  v_prev  text;
BEGIN
  NEW.dia_operativo := dia_operativo(NEW.fecha);
  -- Bloquea el insumo: dos compras simultáneas no pueden pisarse el promedio
  SELECT costo_promedio INTO v_cp FROM insumos WHERE id = NEW.insumo_id FOR UPDATE;
  IF NEW.costo_unitario IS NULL THEN
    NEW.costo_unitario := v_cp;
  END IF;

  -- Sólo las entradas con costo propio (compra, carga inicial) mueven el promedio.
  -- Consumos, mermas y ajustes salen/entran al promedio vigente y no lo cambian.
  IF NEW.tipo IN ('compra','inicial') AND NEW.cantidad <> 0 THEN
    SELECT COALESCE(SUM(cantidad), 0) INTO v_stock FROM inventario_movimientos WHERE insumo_id = NEW.insumo_id;
    IF NEW.cantidad > 0 THEN
      v_nuevo := CASE WHEN v_stock <= 0 THEN NEW.costo_unitario
                      ELSE (v_stock * v_cp + NEW.cantidad * NEW.costo_unitario) / (v_stock + NEW.cantidad) END;
    ELSIF v_stock + NEW.cantidad > 0 THEN
      -- Reverso de una compra: se saca su aportación al promedio
      v_nuevo := GREATEST((v_stock * v_cp + NEW.cantidad * NEW.costo_unitario) / (v_stock + NEW.cantidad), 0);
    ELSE
      v_nuevo := v_cp;
    END IF;
    v_prev := current_setting('mrsmash.origen_costo', true);
    PERFORM set_config('mrsmash.origen_costo', CASE WHEN NEW.tipo = 'compra' THEN 'compra' ELSE 'manual' END, true);
    UPDATE insumos SET costo_promedio = round(v_nuevo, 6) WHERE id = NEW.insumo_id;
    PERFORM set_config('mrsmash.origen_costo', COALESCE(v_prev, ''), true);
  END IF;
  RETURN NEW;
END $$;

-- Si cambian los % de Didi, se recalcula el neto Didi de todos los productos
CREATE OR REPLACE FUNCTION trg_config_didi() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE productos SET precio_didi = precio_didi WHERE negocio_id = NEW.negocio_id AND precio_didi IS NOT NULL;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER config_didi AFTER UPDATE OF pct_comision_didi, pct_promos_didi, pct_retenciones_didi ON configuracion_negocio
  FOR EACH ROW WHEN (NEW.pct_comision_didi IS DISTINCT FROM OLD.pct_comision_didi
                  OR NEW.pct_promos_didi IS DISTINCT FROM OLD.pct_promos_didi
                  OR NEW.pct_retenciones_didi IS DISTINCT FROM OLD.pct_retenciones_didi)
  EXECUTE FUNCTION trg_config_didi();

-- ── 5) Ventas nuevas: si una partida llega sin precio o sin costo (ej. el bot vía /api/pedidos),
--       se toma el vigente del catálogo AL MOMENTO de la venta. Nunca toca filas existentes.
CREATE OR REPLACE FUNCTION trg_pedido_items_defaults() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF COALESCE(NEW.costo, 0) = 0 THEN
    NEW.costo := COALESCE((SELECT costo_insumos FROM productos WHERE id = NEW.producto_id), 0);
  END IF;
  IF COALESCE(NEW.precio, 0) = 0 THEN
    NEW.precio := COALESCE((
      SELECT CASE pe.canal WHEN 'didi' THEN pr.precio_didi
                           WHEN 'salon' THEN pr.precio_salon WHEN 'manual' THEN pr.precio_salon
                           ELSE pr.precio_whatsapp END
      FROM pedidos pe, productos pr WHERE pe.id = NEW.pedido_id AND pr.id = NEW.producto_id), 0);
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER pedido_items_defaults BEFORE INSERT ON pedido_items
  FOR EACH ROW EXECUTE FUNCTION trg_pedido_items_defaults();

-- ── 6) Tasas Didi desde configuración (adiós a los 0.235 / 0.241 / 0.476 escritos en SQL) ──
-- Comisión, promos y retenciones = configuracion_negocio (prellenadas con el histórico real).
CREATE OR REPLACE VIEW v_didi_tasas AS
SELECT c.negocio_id,
       i.bruta::numeric AS bruta,
       COALESCE(c.pct_comision_didi, 0)::numeric AS tasa_comision,
       COALESCE(c.pct_promos_didi, 0)::numeric AS tasa_promos,
       COALESCE(c.pct_retenciones_didi, i.ret, 0)::numeric AS tasa_retenciones
FROM configuracion_negocio c
LEFT JOIN (
  SELECT negocio_id, SUM(venta_bruta) AS bruta,
         GREATEST(SUM(venta_bruta - comision_didi - costo_promos - ganancia_neta), 0) / NULLIF(SUM(venta_bruta), 0) AS ret
  FROM importaciones_didi GROUP BY negocio_id
) i ON i.negocio_id = c.negocio_id;

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
       CASE WHEN p.canal_n = 'didi' THEN round(b.bruta * COALESCE(t.tasa_comision, 0), 2) ELSE 0 END AS comision,
       CASE WHEN p.canal_n = 'didi' THEN round(b.bruta * COALESCE(t.tasa_promos, 0), 2) ELSE 0 END AS promos,
       CASE WHEN p.canal_n = 'didi' THEN round(b.bruta * COALESCE(t.tasa_retenciones, 0), 2) ELSE 0 END AS retenciones,
       -- neta = bruta − comisión − promos. Las retenciones NO restan: son anticipo de impuestos
       -- (columna retenciones, línea aparte "Impuestos retenidos por Didi").
       CASE WHEN p.canal_n = 'didi'
            THEN b.bruta - round(b.bruta * COALESCE(t.tasa_comision, 0), 2)
                         - round(b.bruta * COALESCE(t.tasa_promos, 0), 2)
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
       -- retenciones reales: neta − retenciones = ganancia_neta (lo que Didi depositó), sin recortar
       -- filas con bonificación (pueden salir negativas)
       d.venta_bruta - COALESCE(d.comision_didi, 0) - COALESCE(d.costo_promos, 0) - COALESCE(d.ganancia_neta, 0),
       d.venta_bruta - COALESCE(d.comision_didi, 0) - COALESCE(d.costo_promos, 0), false
FROM importaciones_didi d
WHERE NOT EXISTS (SELECT 1 FROM pedidos x
                  WHERE x.negocio_id = d.negocio_id AND x.canal = 'didi' AND NOT x.cancelado
                    AND COALESCE(x.dia_operativo_corregido, x.fecha) = d.fecha);

-- Margen por producto y canal: precio de cada canal (local con su propio precio) y Didi neto
-- = precio_didi_neto (comisión + promos de configuración).
CREATE OR REPLACE FUNCTION margenes_producto(p_negocio uuid, p_desde date, p_hasta date)
RETURNS TABLE (producto_id uuid, nombre text, burger boolean, tiene_receta boolean, costo numeric,
               canal text, precio numeric, precio_neto numeric, margen numeric, unidades numeric)
LANGUAGE sql STABLE AS $$
  WITH prod AS (
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
  SELECT pr.id, pr.nombre, COALESCE(pr.categoria = 'burger', es_burger(pr.nombre)), pr.tiene_receta, pr.costo,
         ch.canal, ch.precio, ch.neto, round(ch.neto - pr.costo, 2), COALESCE(u.unidades, 0)
  FROM prod pr
  CROSS JOIN LATERAL (VALUES
    ('whatsapp', COALESCE(pr.precio_whatsapp, pr.precio_venta), COALESCE(pr.precio_whatsapp, pr.precio_venta)),
    ('salon',    COALESCE(pr.precio_salon, pr.precio_whatsapp, pr.precio_venta), COALESCE(pr.precio_salon, pr.precio_whatsapp, pr.precio_venta)),
    ('didi',     pr.precio_didi, pr.precio_didi_neto)
  ) AS ch(canal, precio, neto)
  LEFT JOIN u ON u.producto_id = pr.id AND u.canal = ch.canal
  WHERE ch.precio IS NOT NULL
  ORDER BY pr.orden, ch.canal
$$;

-- Partidas vendidas: el costo es SIEMPRE el guardado en la venta (pi.costo). Antes, si una partida
-- tenía costo 0 se usaba productos.costo_insumos ACTUAL, lo que habría recalculado el pasado con
-- costos nuevos. Verificado: 0 de 565 partidas tienen costo 0, y trg_pedido_items_defaults impide
-- partidas nuevas sin costo. Burgers por categoría (con respaldo por nombre).
CREATE OR REPLACE VIEW v_items_base AS
SELECT b.negocio_id, b.dia, b.canal, b.pedido_id, pi.id AS item_id, pi.producto_id, pr.nombre,
       pi.cantidad, pi.precio, COALESCE(pr.categoria = 'burger', es_burger(pr.nombre)) AS burger,
       COALESCE(inv.costo, pi.cantidad * COALESCE(pi.costo, 0)) AS costo,
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

-- Cashflow: igual que en la 06, pero lo que Didi deposita = neta − retenciones
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
           COALESCE(SUM(b.neta - b.retenciones) FILTER (WHERE b.canal = 'didi'), 0) / 4.0 AS didi   -- depósito esperado: sin retenciones
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

-- ── 7) Lote atómico de cambios ───────────────────────────────
-- payload: { negocio_id, motivo?,
--   costos:  [{ insumo_id, costo_unitario }]                 (por unidad_base)
--   recetas: [{ producto_id, insumo_id, cantidad }]          (0 o null = quitar la línea)
--   precios: [{ producto_id, precio_whatsapp?, precio_didi?, precio_salon?, disponible?, costo_insumos? }] }
-- Todo o nada: cualquier error revierte el lote completo.
CREATE OR REPLACE FUNCTION aplicar_cambios_precios_costos(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  x      jsonb;
  v_neg  uuid := (p_payload->>'negocio_id')::uuid;
  v_num  numeric;
  n_c int := 0; n_r int := 0; n_p int := 0;
BEGIN
  IF v_neg IS NULL THEN RAISE EXCEPTION 'Falta negocio_id'; END IF;
  PERFORM set_config('mrsmash.motivo', COALESCE(NULLIF(trim(p_payload->>'motivo'), ''), ''), true);
  PERFORM set_config('mrsmash.origen_costo', 'manual', true);

  -- 1) Costos de insumos (dispara historial_costos y re-sincroniza productos)
  FOR x IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'costos', '[]'::jsonb)) LOOP
    v_num := (x->>'costo_unitario')::numeric;
    IF v_num IS NULL OR v_num < 0 THEN RAISE EXCEPTION 'Costo inválido (%)', COALESCE(x->>'costo_unitario', 'vacío'); END IF;
    UPDATE insumos SET costo_promedio = round(v_num, 6) WHERE id = (x->>'insumo_id')::uuid AND negocio_id = v_neg;
    IF NOT FOUND THEN RAISE EXCEPTION 'Insumo no encontrado: %', x->>'insumo_id'; END IF;
    n_c := n_c + 1;
  END LOOP;

  -- 2) Recetas (re-sincroniza costo_insumos por trigger)
  FOR x IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'recetas', '[]'::jsonb)) LOOP
    v_num := NULLIF(x->>'cantidad', '')::numeric;
    IF COALESCE(v_num, 0) > 0 THEN
      INSERT INTO recetas (negocio_id, producto_id, insumo_id, cantidad)
      VALUES (v_neg, (x->>'producto_id')::uuid, (x->>'insumo_id')::uuid, v_num)
      ON CONFLICT (producto_id, insumo_id) DO UPDATE SET cantidad = EXCLUDED.cantidad;
    ELSIF v_num < 0 THEN
      RAISE EXCEPTION 'Cantidad de receta inválida';
    ELSE
      DELETE FROM recetas WHERE producto_id = (x->>'producto_id')::uuid AND insumo_id = (x->>'insumo_id')::uuid;
    END IF;
    n_r := n_r + 1;
  END LOOP;

  -- 3) Precios por canal, disponibilidad y costo manual (sólo productos sin receta)
  FOR x IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'precios', '[]'::jsonb)) LOOP
    IF (x ? 'precio_whatsapp' AND (x->>'precio_whatsapp')::numeric < 0)
       OR (x ? 'precio_didi' AND (x->>'precio_didi')::numeric < 0)
       OR (x ? 'precio_salon' AND (x->>'precio_salon')::numeric < 0) THEN
      RAISE EXCEPTION 'Precio negativo';
    END IF;
    IF x ? 'costo_insumos' AND costo_receta_producto((x->>'producto_id')::uuid) IS NOT NULL THEN
      RAISE EXCEPTION 'Ese producto tiene receta: su costo sale de la receta, no se edita a mano';
    END IF;
    UPDATE productos SET
      precio_whatsapp = CASE WHEN x ? 'precio_whatsapp' THEN (x->>'precio_whatsapp')::numeric ELSE precio_whatsapp END,
      precio_didi     = CASE WHEN x ? 'precio_didi'     THEN (x->>'precio_didi')::numeric     ELSE precio_didi END,
      precio_salon    = CASE WHEN x ? 'precio_salon'    THEN (x->>'precio_salon')::numeric    ELSE precio_salon END,
      disponible      = CASE WHEN x ? 'disponible'      THEN (x->>'disponible')::boolean      ELSE disponible END,
      costo_insumos   = CASE WHEN x ? 'costo_insumos'   THEN (x->>'costo_insumos')::numeric   ELSE costo_insumos END
    WHERE id = (x->>'producto_id')::uuid AND negocio_id = v_neg;
    IF NOT FOUND THEN RAISE EXCEPTION 'Producto no encontrado: %', x->>'producto_id'; END IF;
    n_p := n_p + 1;
  END LOOP;

  PERFORM set_config('mrsmash.motivo', '', true);
  PERFORM set_config('mrsmash.origen_costo', '', true);
  RETURN jsonb_build_object('costos', n_c, 'recetas', n_r, 'precios', n_p);
END $$;

-- ── 8) Lecturas para el panel y el dashboard ─────────────────
-- Unidades vendidas por producto en las 4 semanas que terminan en el último día con ventas
CREATE OR REPLACE FUNCTION volumen_productos(p_negocio uuid)
RETURNS TABLE (producto_id uuid, unidades numeric, desde date, hasta date)
LANGUAGE sql STABLE AS $$
  WITH ref AS (SELECT COALESCE(max(dia), dia_operativo(now())) AS h FROM v_items_base
               WHERE negocio_id = p_negocio AND dia <= dia_operativo(now()))
  SELECT i.producto_id, SUM(i.cantidad), (SELECT h FROM ref) - 27, (SELECT h FROM ref)
  FROM v_items_base i
  WHERE i.negocio_id = p_negocio AND i.dia BETWEEN (SELECT h FROM ref) - 27 AND (SELECT h FROM ref)
  GROUP BY i.producto_id
$$;

-- Insumos cuyo costo subió ≥ 3 % en los últimos 60 días y el producto más afectado
CREATE OR REPLACE FUNCTION alertas_costos(p_negocio uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH h AS (
    SELECT insumo_id, min(created_at) AS desde,
           (array_agg(costo_anterior ORDER BY created_at) FILTER (WHERE costo_anterior > 0))[1] AS antes
    FROM historial_costos
    WHERE negocio_id = p_negocio AND created_at > now() - interval '60 days'
    GROUP BY insumo_id
  )
  SELECT COALESCE(jsonb_agg(x ORDER BY x.impacto DESC), '[]'::jsonb) FROM (
    SELECT i.nombre AS insumo, dia_operativo(h.desde) AS desde, h.antes, i.costo_promedio AS ahora,
           round(i.costo_promedio / h.antes - 1, 4) AS pct,
           top.producto, top.delta_margen, top.costo AS costo_producto,
           top.precio_whatsapp, top.precio_didi, top.precio_salon,
           top.delta_margen AS impacto
    FROM h
    JOIN insumos i ON i.id = h.insumo_id
    JOIN LATERAL (
      SELECT p.nombre AS producto, round(r.cantidad * (i.costo_promedio - h.antes), 2) AS delta_margen,
             p.costo_insumos AS costo, p.precio_whatsapp, p.precio_didi, p.precio_salon
      FROM recetas r JOIN productos p ON p.id = r.producto_id
      WHERE r.insumo_id = i.id
      ORDER BY p.disponible DESC, r.cantidad * (i.costo_promedio - h.antes) DESC LIMIT 1
    ) top ON true
    WHERE h.antes > 0 AND i.costo_promedio >= h.antes * 1.03
  ) x
$$;

-- ── 9) Sincronización inicial: costo_insumos = costo de receta en productos con receta ──
SELECT sincronizar_costo_productos(ARRAY(SELECT DISTINCT producto_id FROM recetas));
-- y el neto Didi con los % de configuración
UPDATE productos SET precio_didi = precio_didi WHERE precio_didi IS NOT NULL;

-- ── Permisos ──
ALTER TABLE historial_precios DISABLE ROW LEVEL SECURITY;
ALTER TABLE historial_costos  DISABLE ROW LEVEL SECURITY;
GRANT ALL ON historial_precios, historial_costos TO anon, authenticated, service_role;
GRANT SELECT ON v_didi_tasas, v_pedidos_base TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;
