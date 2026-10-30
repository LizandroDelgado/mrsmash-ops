-- ============================================================
-- MR. SMASH ERP · Migración 08: todo lo capturado se puede editar y eliminar
-- Aditiva: ADD COLUMN, CREATE TABLE, CREATE OR REPLACE. Nada de DROP.
-- Reglas:
--   1) El ledger no se edita en sitio: editar = revertir el movimiento original y publicar
--      uno nuevo; eliminar = sólo revertir. Los reversos van fechados en el día del original.
--   2) Inventario igual: editar partidas/desglose revierte y vuelve a aplicar; el costo
--      promedio se recalcula reproduciendo las compras en orden (recalcular_costo_promedio).
--   3) Eliminar lo que movió dinero o inventario = ANULAR (anulado + anulado_at). Lo que no
--      movió nada se borra; si tiene registros ligados se desactiva (borrar_o_desactivar).
--   4) Auditoría: auditoria_cambios con un trigger genérico (editar | anular | borrar).
-- ============================================================

-- ── 1) Columnas de anulación ─────────────────────────────────
ALTER TABLE pedidos                ADD COLUMN IF NOT EXISTS anulado boolean NOT NULL DEFAULT false;
ALTER TABLE pedidos                ADD COLUMN IF NOT EXISTS anulado_at timestamptz;
ALTER TABLE compras_insumos        ADD COLUMN IF NOT EXISTS anulado boolean NOT NULL DEFAULT false;
ALTER TABLE compras_insumos        ADD COLUMN IF NOT EXISTS anulado_at timestamptz;
ALTER TABLE movimientos            ADD COLUMN IF NOT EXISTS anulado boolean NOT NULL DEFAULT false;
ALTER TABLE movimientos            ADD COLUMN IF NOT EXISTS anulado_at timestamptz;
ALTER TABLE cortes_caja            ADD COLUMN IF NOT EXISTS anulado boolean NOT NULL DEFAULT false;
ALTER TABLE cortes_caja            ADD COLUMN IF NOT EXISTS anulado_at timestamptz;
ALTER TABLE pagos_obligacion       ADD COLUMN IF NOT EXISTS anulado boolean NOT NULL DEFAULT false;
ALTER TABLE pagos_obligacion       ADD COLUMN IF NOT EXISTS anulado_at timestamptz;
ALTER TABLE inventario_movimientos ADD COLUMN IF NOT EXISTS anulado boolean NOT NULL DEFAULT false;
ALTER TABLE inventario_movimientos ADD COLUMN IF NOT EXISTS anulado_at timestamptz;
ALTER TABLE conteos_inventario     ADD COLUMN IF NOT EXISTS anulado boolean NOT NULL DEFAULT false;
ALTER TABLE conteos_inventario     ADD COLUMN IF NOT EXISTS anulado_at timestamptz;
ALTER TABLE obligaciones           ADD COLUMN IF NOT EXISTS notas text;

-- Grupo de un movimiento: todo lo que pertenece a la misma operación (original, reversos y
-- reemplazos) comparte clave = COALESCE(grupo_id, transferencia_id, ref_id, id).
ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS grupo_id uuid;
CREATE INDEX IF NOT EXISTS movimientos_clave_idx ON movimientos ((COALESCE(grupo_id, transferencia_id, ref_id, id)));

-- ── 2) Auditoría ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS auditoria_cambios (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  negocio_id  uuid REFERENCES negocios(id),
  tabla       text NOT NULL,
  registro_id uuid,
  accion      text NOT NULL CHECK (accion IN ('editar','anular','borrar')),
  antes       jsonb,
  despues     jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auditoria_idx ON auditoria_cambios (negocio_id, created_at DESC);
CREATE INDEX IF NOT EXISTS auditoria_registro_idx ON auditoria_cambios (tabla, registro_id);

-- Trigger genérico. TG_ARGV[0] = columnas derivadas a ignorar (separadas por coma).
-- Guarda sólo los campos que cambiaron (antes/después); al borrar, la fila completa.
CREATE OR REPLACE FUNCTION trg_auditoria() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_ign  text[] := string_to_array(COALESCE(TG_ARGV[0], ''), ',');
  v_old  jsonb := to_jsonb(OLD);
  v_new  jsonb;
  v_a    jsonb := '{}'::jsonb;
  v_d    jsonb := '{}'::jsonb;
  k      text;
  v_neg  uuid;
  v_acc  text;
BEGIN
  v_neg := NULLIF(v_old->>'negocio_id', '')::uuid;
  IF v_neg IS NULL AND v_old ? 'pedido_id' THEN
    SELECT negocio_id INTO v_neg FROM pedidos WHERE id = (v_old->>'pedido_id')::uuid;
  END IF;
  IF TG_OP = 'DELETE' THEN
    INSERT INTO auditoria_cambios (negocio_id, tabla, registro_id, accion, antes)
    VALUES (v_neg, TG_TABLE_NAME, NULLIF(v_old->>'id', '')::uuid, 'borrar', v_old);
    RETURN OLD;
  END IF;
  v_new := to_jsonb(NEW);
  FOR k IN SELECT jsonb_object_keys(v_new) LOOP
    CONTINUE WHEN k = ANY (v_ign);
    IF (v_new->k) IS DISTINCT FROM (v_old->k) THEN
      v_a := v_a || jsonb_build_object(k, v_old->k);
      v_d := v_d || jsonb_build_object(k, v_new->k);
    END IF;
  END LOOP;
  IF v_d = '{}'::jsonb THEN RETURN NEW; END IF;
  -- En obligaciones, los cambios de estado por pagos (pendiente/parcial/pagada) no son ediciones
  IF TG_TABLE_NAME = 'obligaciones' AND (v_d - 'estado') = '{}'::jsonb AND v_new->>'estado' <> 'cancelada' THEN
    RETURN NEW;
  END IF;
  v_acc := CASE WHEN COALESCE((v_d->>'anulado')::boolean, false) OR v_d->>'estado' = 'cancelada'
                THEN 'anular' ELSE 'editar' END;
  INSERT INTO auditoria_cambios (negocio_id, tabla, registro_id, accion, antes, despues)
  VALUES (v_neg, TG_TABLE_NAME, NULLIF(v_new->>'id', '')::uuid, v_acc, v_a, v_d);
  RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER auditoria AFTER UPDATE OR DELETE ON pedidos
  FOR EACH ROW EXECUTE FUNCTION trg_auditoria('cuenta_id,en_ledger,dia_operativo_corregido,anulado_at');
CREATE OR REPLACE TRIGGER auditoria AFTER UPDATE OR DELETE ON pedido_items
  FOR EACH ROW EXECUTE FUNCTION trg_auditoria('');
CREATE OR REPLACE TRIGGER auditoria AFTER UPDATE OR DELETE ON compras_insumos
  FOR EACH ROW EXECUTE FUNCTION trg_auditoria('cuenta_id,en_ledger,fecha_vencimiento,anulado_at');
CREATE OR REPLACE TRIGGER auditoria AFTER UPDATE OR DELETE ON compra_items
  FOR EACH ROW EXECUTE FUNCTION trg_auditoria('');
CREATE OR REPLACE TRIGGER auditoria AFTER UPDATE OR DELETE ON obligaciones
  FOR EACH ROW EXECUTE FUNCTION trg_auditoria('monto_pagado');
CREATE OR REPLACE TRIGGER auditoria AFTER UPDATE OR DELETE ON pagos_obligacion
  FOR EACH ROW EXECUTE FUNCTION trg_auditoria('movimiento_id,anulado_at');
CREATE OR REPLACE TRIGGER auditoria AFTER UPDATE OR DELETE ON gastos_recurrentes
  FOR EACH ROW EXECUTE FUNCTION trg_auditoria('');
CREATE OR REPLACE TRIGGER auditoria AFTER UPDATE OR DELETE ON proveedores
  FOR EACH ROW EXECUTE FUNCTION trg_auditoria('');
CREATE OR REPLACE TRIGGER auditoria AFTER UPDATE OR DELETE ON movimientos
  FOR EACH ROW EXECUTE FUNCTION trg_auditoria('anulado_at');
CREATE OR REPLACE TRIGGER auditoria AFTER UPDATE OR DELETE ON cortes_caja
  FOR EACH ROW EXECUTE FUNCTION trg_auditoria('movimiento_id,saldo_esperado,anulado_at');
CREATE OR REPLACE TRIGGER auditoria AFTER UPDATE OR DELETE ON inventario_movimientos
  FOR EACH ROW EXECUTE FUNCTION trg_auditoria('anulado_at');
CREATE OR REPLACE TRIGGER auditoria AFTER UPDATE OR DELETE ON conteos_inventario
  FOR EACH ROW EXECUTE FUNCTION trg_auditoria('cerrado,cerrado_at,valor_diferencia,valor_inventario,anulado_at');
CREATE OR REPLACE TRIGGER auditoria AFTER UPDATE OR DELETE ON conteo_items
  FOR EACH ROW EXECUTE FUNCTION trg_auditoria('cantidad_teorica,diferencia,valor_diferencia');
CREATE OR REPLACE TRIGGER auditoria AFTER UPDATE OR DELETE ON insumos
  FOR EACH ROW EXECUTE FUNCTION trg_auditoria('costo_promedio,costo_origen');
CREATE OR REPLACE TRIGGER auditoria AFTER UPDATE OR DELETE ON productos
  FOR EACH ROW EXECUTE FUNCTION trg_auditoria('costo_insumos,precio_didi_neto,precio_didi_cobro');
CREATE OR REPLACE TRIGGER auditoria AFTER UPDATE OR DELETE ON recetas
  FOR EACH ROW EXECUTE FUNCTION trg_auditoria('');
CREATE OR REPLACE TRIGGER auditoria AFTER UPDATE OR DELETE ON configuracion_negocio
  FOR EACH ROW EXECUTE FUNCTION trg_auditoria('updated_at');

-- ── 3) Ledger: reversos fechados en el día original y por grupo ──
-- (misma firma que en la 02; ahora el reverso queda en la fecha del movimiento original,
--  así el saldo de cada día queda como si el error no hubiera existido)
CREATE OR REPLACE FUNCTION revertir_movimientos(p_tabla text, p_ref uuid, p_motivo text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT negocio_id, cuenta_id, tipo, categoria, fecha,
           SUM(monto) AS neto, SUM(COALESCE(monto_bruto, 0)) AS bruto,
           bool_or(monto_bruto IS NOT NULL) AS tiene_bruto
    FROM movimientos
    WHERE ref_tabla = p_tabla AND ref_id = p_ref
    GROUP BY negocio_id, cuenta_id, tipo, categoria, fecha
    HAVING SUM(monto) <> 0
  LOOP
    INSERT INTO movimientos (negocio_id, fecha, cuenta_id, monto, monto_bruto, tipo, categoria, descripcion, ref_tabla, ref_id)
    VALUES (r.negocio_id, r.fecha, r.cuenta_id, -r.neto, CASE WHEN r.tiene_bruto THEN -r.bruto END,
            r.tipo, r.categoria, p_motivo, p_tabla, p_ref);
  END LOOP;
END $$;

-- Revierte el neto vigente de TODO un grupo (original + reemplazos), por cuenta, tipo y fecha
CREATE OR REPLACE FUNCTION revertir_grupo(p_clave uuid, p_motivo text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT negocio_id, cuenta_id, tipo, categoria, fecha, transferencia_id, ref_tabla, ref_id,
           SUM(monto) AS neto, SUM(COALESCE(monto_bruto, 0)) AS bruto, bool_or(monto_bruto IS NOT NULL) AS tiene_bruto
    FROM movimientos
    WHERE COALESCE(grupo_id, transferencia_id, ref_id, id) = p_clave
    GROUP BY negocio_id, cuenta_id, tipo, categoria, fecha, transferencia_id, ref_tabla, ref_id
    HAVING SUM(monto) <> 0
  LOOP
    INSERT INTO movimientos (negocio_id, fecha, cuenta_id, monto, monto_bruto, tipo, categoria, descripcion,
                             ref_tabla, ref_id, transferencia_id, grupo_id)
    VALUES (r.negocio_id, r.fecha, r.cuenta_id, -r.neto, CASE WHEN r.tiene_bruto THEN -r.bruto END,
            r.tipo, r.categoria, p_motivo, r.ref_tabla, r.ref_id, r.transferencia_id, p_clave);
  END LOOP;
END $$;

-- Vista de Caja: una fila por operación y cuenta con el resultado NETO (sin pares de reverso).
-- editado = tuvo reversos y sigue vivo; anulado = neto 0 con reversos (la UI lo oculta).
CREATE OR REPLACE VIEW v_movimientos_caja AS
WITH m0 AS (
  SELECT m.*, COALESCE(m.grupo_id, m.transferencia_id, m.ref_id, m.id) AS clave,
         (m.descripcion LIKE 'Reverso%') AS es_reverso
  FROM movimientos m
),
m AS (
  SELECT m0.*, bool_or(m0.es_reverso) OVER (PARTITION BY m0.clave) AS grupo_con_reverso FROM m0
)
SELECT m.negocio_id, m.clave, m.cuenta_id,
       (array_agg(m.id ORDER BY m.created_at, m.id))[1] AS id,
       SUM(m.monto) AS monto,
       (array_agg(m.fecha ORDER BY m.es_reverso, m.created_at DESC))[1] AS fecha,
       (array_agg(m.dia_operativo ORDER BY m.es_reverso, m.created_at DESC))[1] AS dia_operativo,
       (array_agg(m.tipo ORDER BY m.es_reverso, m.created_at DESC))[1] AS tipo,
       (array_agg(m.categoria ORDER BY m.es_reverso, m.created_at DESC))[1] AS categoria,
       (array_agg(m.descripcion ORDER BY m.es_reverso, m.created_at DESC))[1] AS descripcion,
       max(m.ref_tabla) AS ref_tabla, (array_agg(m.ref_id))[1] AS ref_id,
       bool_or(m.transferencia_id IS NOT NULL) AS es_transferencia,
       (bool_or(m.grupo_con_reverso) AND SUM(m.monto) <> 0) AS editado,
       (bool_or(m.grupo_con_reverso) AND SUM(m.monto) = 0) AS anulado,
       max(m.created_at) AS actualizado
FROM m
GROUP BY m.negocio_id, m.clave, m.cuenta_id;

-- ── 4) Pedidos: editar (lote atómico) y anular ───────────────
-- Anular un pedido lo marca cancelado también: así ledger, inventario y reportes lo excluyen.
CREATE OR REPLACE FUNCTION trg_pedidos_anulado() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.anulado AND NOT OLD.anulado THEN
    NEW.cancelado := true; NEW.anulado_at := now();
  ELSIF OLD.anulado AND NOT NEW.anulado THEN
    NEW.cancelado := false; NEW.anulado_at := NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER pedidos_anulado BEFORE UPDATE OF anulado ON pedidos
  FOR EACH ROW EXECUTE FUNCTION trg_pedidos_anulado();

-- Inventario: "UPDATE OF cancelado" no se dispara si cancelado lo cambia el trigger de anulado,
-- así que también escucha anulado
CREATE OR REPLACE TRIGGER pedidos_inventario AFTER UPDATE OF cancelado, fecha, anulado ON pedidos
  FOR EACH ROW WHEN (NEW.cancelado IS DISTINCT FROM OLD.cancelado OR NEW.fecha IS DISTINCT FROM OLD.fecha
                  OR NEW.anulado IS DISTINCT FROM OLD.anulado)
  EXECUTE FUNCTION trg_pedidos_inventario();

-- El ledger también reacciona a cambio de canal (categoría de la venta)
CREATE OR REPLACE FUNCTION trg_pedidos_after() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM registrar_venta_pedido(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.en_ledger AND (
         NEW.total       IS DISTINCT FROM OLD.total
      OR NEW.total_bruto IS DISTINCT FROM OLD.total_bruto
      OR NEW.cuenta_id   IS DISTINCT FROM OLD.cuenta_id
      OR NEW.cancelado   IS DISTINCT FROM OLD.cancelado
      OR NEW.canal       IS DISTINCT FROM OLD.canal
      OR NEW.fecha       IS DISTINCT FROM OLD.fecha) THEN
      PERFORM revertir_movimientos('pedidos', NEW.id,
        CASE WHEN NEW.anulado AND NOT OLD.anulado THEN 'Reverso: pedido anulado'
             WHEN NEW.cancelado AND NOT OLD.cancelado THEN 'Reverso: pedido cancelado'
             ELSE 'Reverso: pedido editado' END);
      PERFORM registrar_venta_pedido(NEW);
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.en_ledger THEN
      PERFORM revertir_movimientos('pedidos', OLD.id, 'Reverso: pedido borrado');
    END IF;
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;

-- payload: { canal?, metodo_pago?, cliente_nombre?, notas?, fecha?, estado?,
--            items: [{ id?, producto_id, cantidad, precio? }] }   (la lista completa deseada)
-- El total se recalcula: directo = Σ precio × cantidad; Didi: bruto = Σ, total = lo que deposita.
CREATE OR REPLACE FUNCTION editar_pedido(p_pedido uuid, p jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  pe      pedidos;
  it      jsonb;
  v_ids   uuid[] := '{}';
  v_canal text;
  v_bruto numeric;
  v_total numeric;
  v_nuevo uuid;
BEGIN
  SELECT * INTO pe FROM pedidos WHERE id = p_pedido FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido no encontrado'; END IF;
  IF pe.anulado THEN RAISE EXCEPTION 'Este pedido está anulado'; END IF;
  IF p ? 'items' AND jsonb_array_length(p->'items') = 0 THEN RAISE EXCEPTION 'El pedido necesita al menos un producto'; END IF;
  v_canal := COALESCE(p->>'canal', pe.canal);

  -- Datos generales (sin total todavía)
  UPDATE pedidos SET
    canal          = v_canal,
    metodo_pago    = CASE WHEN v_canal = 'didi' THEN 'didi'
                          WHEN p ? 'metodo_pago' THEN p->>'metodo_pago'
                          WHEN metodo_pago = 'didi' THEN 'efectivo' ELSE metodo_pago END,
    cliente_nombre = CASE WHEN p ? 'cliente_nombre' THEN NULLIF(trim(p->>'cliente_nombre'), '') ELSE cliente_nombre END,
    notas          = CASE WHEN p ? 'notas' THEN NULLIF(trim(p->>'notas'), '') ELSE notas END,
    estado         = COALESCE(p->>'estado', estado),
    fecha          = COALESCE((p->>'fecha')::date, fecha)
  WHERE id = p_pedido;

  -- Partidas: actualizar, agregar, quitar (los triggers revierten y re-aplican inventario)
  IF p ? 'items' THEN
    FOR it IN SELECT * FROM jsonb_array_elements(p->'items') LOOP
      IF COALESCE((it->>'cantidad')::numeric, 0) <= 0 THEN RAISE EXCEPTION 'Cantidad inválida'; END IF;
      IF it ? 'id' AND it->>'id' IS NOT NULL THEN
        UPDATE pedido_items SET cantidad = (it->>'cantidad')::int,
               producto_id = COALESCE((it->>'producto_id')::uuid, producto_id),
               precio = COALESCE((it->>'precio')::numeric, precio)
        WHERE id = (it->>'id')::uuid AND pedido_id = p_pedido;
        IF NOT FOUND THEN RAISE EXCEPTION 'Partida no encontrada'; END IF;
        v_ids := v_ids || (it->>'id')::uuid;
      ELSE
        INSERT INTO pedido_items (pedido_id, producto_id, cantidad, precio)
        VALUES (p_pedido, (it->>'producto_id')::uuid, (it->>'cantidad')::int, COALESCE((it->>'precio')::numeric, 0))
        RETURNING id INTO v_nuevo;
        v_ids := v_ids || v_nuevo;
      END IF;
    END LOOP;
    DELETE FROM pedido_items WHERE pedido_id = p_pedido AND NOT (id = ANY (v_ids));
  END IF;

  -- Total recalculado desde las partidas
  SELECT COALESCE(SUM(cantidad * precio), 0) INTO v_bruto FROM pedido_items WHERE pedido_id = p_pedido;
  IF v_canal = 'didi' THEN
    v_total := round(v_bruto * (1 - pct_deduccion_didi(pe.negocio_id) - pct_retenciones_didi(pe.negocio_id)), 2);
    UPDATE pedidos SET total = v_total, total_bruto = v_bruto WHERE id = p_pedido;
  ELSE
    UPDATE pedidos SET total = v_bruto, total_bruto = NULL WHERE id = p_pedido;
  END IF;
  RETURN (SELECT to_jsonb(x) FROM pedidos x WHERE id = p_pedido);
END $$;

-- ── 5) Costo promedio reproduciendo compras en orden ─────────
-- Base: el último costo capturado a mano (historial manual) o el costo previo al primer
-- cambio registrado. Desde ahí se reproducen las entradas vivas en orden de captura;
-- las compras revertidas por completo (neto 0) se ignoran.
CREATE OR REPLACE FUNCTION recalcular_costo_promedio(p_insumo uuid)
RETURNS numeric LANGUAGE plpgsql AS $$
DECLARE
  v_ts    timestamptz;
  v_cp    numeric;
  v_stock numeric;
  r       record;
  v_prev  text;
BEGIN
  SELECT created_at, costo_nuevo INTO v_ts, v_cp FROM historial_costos
  WHERE insumo_id = p_insumo AND origen = 'manual' ORDER BY created_at DESC LIMIT 1;
  IF v_ts IS NULL THEN
    v_ts := '-infinity';
    SELECT costo_anterior INTO v_cp FROM historial_costos WHERE insumo_id = p_insumo ORDER BY created_at LIMIT 1;
    IF v_cp IS NULL THEN SELECT costo_promedio INTO v_cp FROM insumos WHERE id = p_insumo; END IF;
  END IF;
  SELECT COALESCE(SUM(cantidad), 0) INTO v_stock FROM inventario_movimientos
  WHERE insumo_id = p_insumo AND created_at <= v_ts;

  FOR r IN
    SELECT m.tipo, m.cantidad, m.costo_unitario
    FROM inventario_movimientos m
    WHERE m.insumo_id = p_insumo AND m.created_at > v_ts
      AND NOT (m.tipo = 'compra' AND m.ref_tabla IS NOT NULL AND EXISTS (
            SELECT 1 FROM inventario_movimientos x
            WHERE x.ref_tabla = m.ref_tabla AND x.ref_id = m.ref_id AND x.insumo_id = m.insumo_id AND x.tipo = 'compra'
            GROUP BY x.ref_id HAVING SUM(x.cantidad) = 0))
    ORDER BY m.created_at, m.id
  LOOP
    IF r.tipo IN ('compra','inicial') AND r.cantidad > 0 THEN
      v_cp := CASE WHEN v_stock <= 0 THEN r.costo_unitario
                   ELSE (v_stock * v_cp + r.cantidad * r.costo_unitario) / (v_stock + r.cantidad) END;
    ELSIF r.tipo IN ('compra','inicial') AND r.cantidad < 0 AND v_stock + r.cantidad > 0 THEN
      v_cp := GREATEST((v_stock * v_cp + r.cantidad * r.costo_unitario) / (v_stock + r.cantidad), 0);
    END IF;
    v_stock := v_stock + r.cantidad;
  END LOOP;

  v_prev := current_setting('mrsmash.origen_costo', true);
  PERFORM set_config('mrsmash.origen_costo', 'compra', true);
  UPDATE insumos SET costo_promedio = round(v_cp, 6)
  WHERE id = p_insumo AND costo_promedio IS DISTINCT FROM round(v_cp, 6);
  PERFORM set_config('mrsmash.origen_costo', COALESCE(v_prev, ''), true);
  RETURN round(v_cp, 6);
END $$;

-- ── 6) Compras: anular, y el desglose recalcula el promedio ──
CREATE OR REPLACE FUNCTION trg_compras_anulado_before() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.anulado AND NEW.anulado IS NOT DISTINCT FROM OLD.anulado THEN
    RAISE EXCEPTION 'Esta compra está anulada: no se puede editar';
  END IF;
  IF OLD.anulado AND NOT NEW.anulado THEN RAISE EXCEPTION 'Una compra anulada no se puede reactivar: captúrala de nuevo'; END IF;
  IF NEW.anulado AND NOT OLD.anulado THEN NEW.anulado_at := now(); END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER compras_anulado_before BEFORE UPDATE ON compras_insumos
  FOR EACH ROW EXECUTE FUNCTION trg_compras_anulado_before();

CREATE OR REPLACE FUNCTION trg_compras_after() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE ci compra_items; v_ins uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM aplicar_compra(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.anulado AND NOT OLD.anulado THEN
      -- Anular: revierte dinero (o cancela el crédito) e inventario; las filas se conservan
      IF OLD.en_ledger THEN PERFORM deshacer_compra(OLD, 'Reverso: compra anulada'); END IF;
      FOR ci IN SELECT * FROM compra_items WHERE compra_id = NEW.id LOOP
        PERFORM revertir_inventario('compra_items', ci.id, 'Reverso: compra anulada');
      END LOOP;
      FOR v_ins IN SELECT DISTINCT insumo_id FROM compra_items WHERE compra_id = NEW.id LOOP
        PERFORM recalcular_costo_promedio(v_ins);
      END LOOP;
    ELSIF NEW.en_ledger AND (
         NEW.monto       IS DISTINCT FROM OLD.monto
      OR NEW.metodo_pago IS DISTINCT FROM OLD.metodo_pago
      OR NEW.cuenta_id   IS DISTINCT FROM OLD.cuenta_id
      OR NEW.proveedor_id IS DISTINCT FROM OLD.proveedor_id
      OR (NEW.fecha IS DISTINCT FROM OLD.fecha AND NEW.metodo_pago <> 'credito')) THEN
      PERFORM deshacer_compra(OLD, 'Reverso: compra editada');
      PERFORM aplicar_compra(NEW);
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.en_ledger AND NOT OLD.anulado THEN
      PERFORM deshacer_compra(OLD, 'Reverso: compra borrada');
    END IF;
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;

-- Re-fechar compra: sólo si no está anulada
CREATE OR REPLACE TRIGGER compras_inventario AFTER UPDATE OF fecha ON compras_insumos
  FOR EACH ROW WHEN (NEW.fecha IS DISTINCT FROM OLD.fecha AND NOT NEW.anulado)
  EXECUTE FUNCTION trg_compras_inventario();

CREATE OR REPLACE FUNCTION trg_compra_items_after() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('INSERT','UPDATE') AND EXISTS (SELECT 1 FROM compras_insumos WHERE id = NEW.compra_id AND anulado) THEN
    RAISE EXCEPTION 'La compra está anulada: no se puede cambiar su desglose';
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM aplicar_compra_item(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM revertir_inventario('compra_items', OLD.id, 'Reverso: compra editada');
    PERFORM aplicar_compra_item(NEW);
    PERFORM recalcular_costo_promedio(OLD.insumo_id);
    IF NEW.insumo_id <> OLD.insumo_id THEN PERFORM recalcular_costo_promedio(NEW.insumo_id); END IF;
  ELSE
    PERFORM revertir_inventario('compra_items', OLD.id, 'Reverso: compra borrada');
    PERFORM recalcular_costo_promedio(OLD.insumo_id);
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;

-- ── 7) Por pagar: pagos con grupo, editar/deshacer pago, editar/cancelar obligación ──
CREATE OR REPLACE FUNCTION recalcular_obligacion(p_obligacion uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_pagado numeric; o obligaciones;
BEGIN
  SELECT * INTO o FROM obligaciones WHERE id = p_obligacion;
  SELECT COALESCE(SUM(monto), 0) INTO v_pagado FROM pagos_obligacion WHERE obligacion_id = p_obligacion AND NOT anulado;
  IF v_pagado > o.monto + 0.005 THEN RAISE EXCEPTION 'Lo pagado (%) excede el monto (%)', v_pagado, o.monto; END IF;
  UPDATE obligaciones SET monto_pagado = v_pagado,
    estado = CASE WHEN estado = 'cancelada' THEN 'cancelada'
                  WHEN v_pagado >= monto - 0.005 THEN 'pagada'
                  WHEN v_pagado > 0 THEN 'parcial' ELSE 'pendiente' END
  WHERE id = p_obligacion;
END $$;

-- Igual que en la 02, pero cada pago tiene su grupo (grupo_id = id del pago)
CREATE OR REPLACE FUNCTION pagar_obligacion(p_obligacion uuid, p_cuenta uuid, p_monto numeric)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE o obligaciones; v_mov uuid; v_pago uuid := gen_random_uuid(); v_pagado numeric; v_estado text;
BEGIN
  SELECT * INTO o FROM obligaciones WHERE id = p_obligacion FOR UPDATE;
  IF o.id IS NULL THEN RAISE EXCEPTION 'Obligación no existe'; END IF;
  IF o.estado IN ('pagada','cancelada') THEN RAISE EXCEPTION 'Esta obligación ya está %', o.estado; END IF;
  IF p_monto <= 0 THEN RAISE EXCEPTION 'El monto debe ser mayor a 0'; END IF;
  IF p_monto > o.monto - o.monto_pagado + 0.005 THEN
    RAISE EXCEPTION 'El pago excede lo pendiente (%)', o.monto - o.monto_pagado;
  END IF;
  INSERT INTO movimientos (negocio_id, cuenta_id, monto, tipo, categoria, descripcion, ref_tabla, ref_id, grupo_id)
  VALUES (o.negocio_id, p_cuenta, -p_monto, 'pago_obligacion', o.categoria, o.concepto, 'obligaciones', o.id, v_pago)
  RETURNING id INTO v_mov;
  INSERT INTO pagos_obligacion (id, negocio_id, obligacion_id, movimiento_id, monto)
  VALUES (v_pago, o.negocio_id, o.id, v_mov, p_monto);
  v_pagado := o.monto_pagado + p_monto;
  v_estado := CASE WHEN v_pagado >= o.monto - 0.005 THEN 'pagada' ELSE 'parcial' END;
  UPDATE obligaciones SET monto_pagado = v_pagado, estado = v_estado WHERE id = o.id;
  RETURN jsonb_build_object('estado', v_estado, 'pagado', v_pagado, 'pendiente', o.monto - v_pagado, 'pago_id', v_pago);
END $$;

-- Clave de grupo de un pago (los anteriores a la 08 no tenían grupo_id: su clave es el movimiento)
CREATE OR REPLACE FUNCTION clave_pago(p_pago uuid) RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN m.grupo_id IS NOT NULL THEN m.grupo_id ELSE m.id END
  FROM pagos_obligacion po JOIN movimientos m ON m.id = po.movimiento_id WHERE po.id = p_pago
$$;

CREATE OR REPLACE FUNCTION editar_pago(p_pago uuid, p_monto numeric, p_cuenta uuid, p_fecha date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE po pagos_obligacion; o obligaciones; v_clave uuid; v_mov uuid; v_cuenta uuid;
BEGIN
  SELECT * INTO po FROM pagos_obligacion WHERE id = p_pago FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pago no encontrado'; END IF;
  IF po.anulado THEN RAISE EXCEPTION 'Este pago está anulado'; END IF;
  IF p_monto <= 0 THEN RAISE EXCEPTION 'El monto debe ser mayor a 0'; END IF;
  SELECT * INTO o FROM obligaciones WHERE id = po.obligacion_id FOR UPDATE;
  SELECT cuenta_id INTO v_cuenta FROM movimientos WHERE id = po.movimiento_id;
  v_clave := clave_pago(p_pago);
  PERFORM revertir_grupo(v_clave, 'Reverso: pago editado');
  INSERT INTO movimientos (negocio_id, fecha, cuenta_id, monto, tipo, categoria, descripcion, ref_tabla, ref_id, grupo_id)
  VALUES (o.negocio_id, ts_de_dia(COALESCE(p_fecha, dia_operativo(po.fecha))), COALESCE(p_cuenta, v_cuenta), -p_monto,
          'pago_obligacion', o.categoria, o.concepto, 'obligaciones', o.id, v_clave)
  RETURNING id INTO v_mov;
  UPDATE pagos_obligacion SET monto = p_monto, movimiento_id = v_mov,
         fecha = ts_de_dia(COALESCE(p_fecha, dia_operativo(po.fecha)))
  WHERE id = p_pago;
  PERFORM recalcular_obligacion(o.id);
  RETURN (SELECT to_jsonb(x) FROM obligaciones x WHERE id = o.id);
END $$;

CREATE OR REPLACE FUNCTION anular_pago(p_pago uuid)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE po pagos_obligacion;
BEGIN
  SELECT * INTO po FROM pagos_obligacion WHERE id = p_pago FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pago no encontrado'; END IF;
  IF po.anulado THEN RETURN NULL; END IF;
  PERFORM revertir_grupo(clave_pago(p_pago), 'Reverso: pago deshecho');
  UPDATE pagos_obligacion SET anulado = true, anulado_at = now() WHERE id = p_pago;
  PERFORM recalcular_obligacion(po.obligacion_id);
  RETURN (SELECT to_jsonb(x) FROM obligaciones x WHERE id = po.obligacion_id);
END $$;

-- payload: { concepto?, monto?, fecha_vencimiento?, categoria?, proveedor_id?, notas? }
-- alcance 'siguientes' (sólo si viene de un gasto fijo): actualiza la plantilla y las futuras sin pagar.
CREATE OR REPLACE FUNCTION editar_obligacion(p_obligacion uuid, p jsonb, p_alcance text DEFAULT 'solo')
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE o obligaciones; g gastos_recurrentes; v_obj uuid := p_obligacion; v_fecha date; v_previas jsonb; v_prev jsonb;
BEGIN
  SELECT * INTO o FROM obligaciones WHERE id = p_obligacion FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Obligación no encontrada'; END IF;
  IF o.estado = 'cancelada' THEN RAISE EXCEPTION 'Esta obligación está cancelada'; END IF;
  IF p ? 'monto' AND (p->>'monto')::numeric <= 0 THEN RAISE EXCEPTION 'El monto debe ser mayor a 0'; END IF;
  v_fecha := (p->>'fecha_vencimiento')::date;

  IF p_alcance = 'siguientes' AND o.gasto_recurrente_id IS NOT NULL THEN
    SELECT * INTO g FROM gastos_recurrentes WHERE id = o.gasto_recurrente_id;
    -- Pendientes ANTERIORES a esta: la plantilla las tocaría (actualiza todo desde hoy); se restauran
    SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb) INTO v_previas FROM obligaciones x
    WHERE x.gasto_recurrente_id = o.gasto_recurrente_id AND x.estado IN ('pendiente','parcial')
      AND x.fecha_vencimiento < o.fecha_vencimiento;
    UPDATE gastos_recurrentes SET
      concepto  = COALESCE(NULLIF(trim(p->>'concepto'), ''), concepto),
      monto     = COALESCE((p->>'monto')::numeric, monto),
      categoria = COALESCE(p->>'categoria', categoria),
      dia_pago  = CASE WHEN v_fecha IS NULL OR v_fecha = o.fecha_vencimiento THEN dia_pago
                       WHEN g.frecuencia = 'semanal' THEN extract(isodow FROM v_fecha)::int
                       WHEN v_fecha = (date_trunc('month', v_fecha) + interval '1 month - 1 day')::date THEN 31
                       ELSE LEAST(extract(day FROM v_fecha)::int, CASE WHEN g.frecuencia = 'quincenal' THEN 15 ELSE 31 END) END
    WHERE id = o.gasto_recurrente_id;
    -- Si el cambio de día canceló y regeneró las futuras, se trabaja sobre la del mismo periodo
    PERFORM generar_obligaciones(o.negocio_id, GREATEST(dia_operativo(now()) + 90, COALESCE(v_fecha, o.fecha_vencimiento)));
    SELECT id INTO v_obj FROM obligaciones
    WHERE gasto_recurrente_id = o.gasto_recurrente_id AND periodo = o.periodo AND estado <> 'cancelada'
    LIMIT 1;
    v_obj := COALESCE(v_obj, p_obligacion);
    FOR v_prev IN SELECT * FROM jsonb_array_elements(v_previas) LOOP
      UPDATE obligaciones SET monto = (v_prev->>'monto')::numeric, concepto = v_prev->>'concepto',
             categoria = v_prev->>'categoria', fecha_vencimiento = (v_prev->>'fecha_vencimiento')::date
      WHERE gasto_recurrente_id = o.gasto_recurrente_id AND periodo = v_prev->>'periodo' AND estado <> 'cancelada';
    END LOOP;
  END IF;

  UPDATE obligaciones SET
    concepto          = COALESCE(NULLIF(trim(p->>'concepto'), ''), concepto),
    monto             = COALESCE((p->>'monto')::numeric, monto),
    fecha_vencimiento = COALESCE(v_fecha, fecha_vencimiento),
    categoria         = COALESCE(p->>'categoria', categoria),
    proveedor_id      = CASE WHEN p ? 'proveedor_id' THEN NULLIF(p->>'proveedor_id', '')::uuid ELSE proveedor_id END,
    notas             = CASE WHEN p ? 'notas' THEN NULLIF(trim(p->>'notas'), '') ELSE notas END
  WHERE id = v_obj;
  PERFORM recalcular_obligacion(v_obj);
  RETURN (SELECT to_jsonb(x) FROM obligaciones x WHERE id = v_obj);
END $$;

-- Cancelar cualquier obligación (también de gastos fijos): deshace sus pagos y queda cancelada.
-- Conserva su periodo, así generar_obligaciones no la vuelve a crear.
CREATE OR REPLACE FUNCTION cancelar_obligacion(p_obligacion uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_pago uuid;
BEGIN
  FOR v_pago IN SELECT id FROM pagos_obligacion WHERE obligacion_id = p_obligacion AND NOT anulado LOOP
    PERFORM anular_pago(v_pago);
  END LOOP;
  UPDATE obligaciones SET estado = 'cancelada' WHERE id = p_obligacion AND estado <> 'cancelada';
END $$;

-- ── 8) Caja: movimientos manuales (retiro, meter dinero, transferencia, cobró Didi, saldo) ──
CREATE OR REPLACE FUNCTION transferir(p_origen uuid, p_destino uuid, p_monto numeric,
                                      p_descripcion text DEFAULT NULL, p_tipo text DEFAULT 'transferencia')
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_tid uuid := gen_random_uuid(); v_neg uuid;
BEGIN
  IF p_monto <= 0 THEN RAISE EXCEPTION 'El monto debe ser mayor a 0'; END IF;
  IF p_origen = p_destino THEN RAISE EXCEPTION 'Elige dos cuentas distintas'; END IF;
  SELECT negocio_id INTO v_neg FROM cuentas WHERE id = p_origen;
  INSERT INTO movimientos (negocio_id, cuenta_id, monto, tipo, descripcion, transferencia_id)
  VALUES (v_neg, p_origen, -p_monto, p_tipo, p_descripcion, v_tid),
         (v_neg, p_destino, p_monto, p_tipo, p_descripcion, v_tid);
  RETURN v_tid;
END $$;

-- Igual que en la 02, pero el ajuste queda en el mismo grupo que el depósito
CREATE OR REPLACE FUNCTION cobrar_didi(p_negocio uuid, p_monto numeric, p_destino uuid DEFAULT NULL,
                                       p_descripcion text DEFAULT 'Depósito Didi')
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_didi uuid; v_dest uuid; v_esperado numeric; v_dif numeric; v_tid uuid;
BEGIN
  IF p_monto <= 0 THEN RAISE EXCEPTION 'El monto debe ser mayor a 0'; END IF;
  v_didi := cuenta_por_clave(p_negocio, 'didi');
  v_dest := COALESCE(p_destino, cuenta_por_clave(p_negocio, 'banco'));
  v_esperado := saldo_cuenta(v_didi);
  v_tid := transferir(v_didi, v_dest, p_monto, p_descripcion, 'cobro_didi');
  v_dif := round(p_monto - v_esperado, 2);
  IF v_dif <> 0 THEN
    INSERT INTO movimientos (negocio_id, cuenta_id, monto, tipo, categoria, descripcion, transferencia_id)
    VALUES (p_negocio, v_didi, v_dif, 'ajuste_didi', 'didi',
            p_descripcion || CASE WHEN v_dif < 0 THEN ' · depositó menos de lo esperado' ELSE ' · depositó más de lo esperado' END, v_tid);
  END IF;
  RETURN jsonb_build_object('esperado', v_esperado, 'depositado', p_monto, 'diferencia', v_dif, 'grupo', v_tid);
END $$;

-- payload: { monto, cuenta_id?, cuenta_destino?, fecha?, descripcion? }
-- monto siempre positivo (salvo saldo inicial, que es con signo).
CREATE OR REPLACE FUNCTION editar_movimiento(p_mov uuid, p jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  m        movimientos;
  v_clave  uuid;
  v_monto  numeric := (p->>'monto')::numeric;
  v_fecha  timestamptz;
  v_desc   text;
  v_origen uuid; v_destino uuid;
  v_esperado numeric; v_dif numeric; v_didi uuid;
BEGIN
  SELECT * INTO m FROM movimientos WHERE id = p_mov;
  IF NOT FOUND THEN RAISE EXCEPTION 'Movimiento no encontrado'; END IF;
  IF m.tipo NOT IN ('retiro_dueno','aportacion_dueno','transferencia','cobro_didi','saldo_inicial','ajuste_didi') THEN
    RAISE EXCEPTION 'Este movimiento se edita desde su origen (Pedidos, Compras, Por pagar o Corte de caja)';
  END IF;
  IF v_monto IS NULL OR (m.tipo <> 'saldo_inicial' AND v_monto <= 0) THEN RAISE EXCEPTION 'Monto inválido'; END IF;
  v_clave := COALESCE(m.grupo_id, m.transferencia_id, m.ref_id, m.id);
  v_fecha := CASE WHEN p ? 'fecha' THEN ts_de_dia((p->>'fecha')::date) ELSE m.fecha END;
  v_desc  := COALESCE(NULLIF(trim(p->>'descripcion'), ''),
                      (SELECT descripcion FROM movimientos WHERE COALESCE(grupo_id, transferencia_id, ref_id, id) = v_clave
                         AND descripcion NOT LIKE 'Reverso%' ORDER BY created_at DESC LIMIT 1));
  -- Cuentas vigentes del grupo (origen = sale, destino = entra)
  SELECT cuenta_id INTO v_origen FROM movimientos WHERE COALESCE(grupo_id, transferencia_id, ref_id, id) = v_clave
    AND tipo IN ('transferencia','cobro_didi') GROUP BY cuenta_id HAVING SUM(monto) < 0 LIMIT 1;
  SELECT cuenta_id INTO v_destino FROM movimientos WHERE COALESCE(grupo_id, transferencia_id, ref_id, id) = v_clave
    AND tipo IN ('transferencia','cobro_didi') GROUP BY cuenta_id HAVING SUM(monto) > 0 LIMIT 1;

  PERFORM revertir_grupo(v_clave, 'Reverso: movimiento editado');

  IF m.tipo IN ('retiro_dueno','aportacion_dueno','saldo_inicial') THEN
    INSERT INTO movimientos (negocio_id, fecha, cuenta_id, monto, tipo, categoria, descripcion, ref_tabla, ref_id, grupo_id)
    VALUES (m.negocio_id, v_fecha, COALESCE((p->>'cuenta_id')::uuid, m.cuenta_id),
            CASE WHEN m.tipo = 'retiro_dueno' THEN -v_monto ELSE v_monto END,
            m.tipo, m.categoria, v_desc, m.ref_tabla, m.ref_id, v_clave);
  ELSIF m.tipo = 'transferencia' THEN
    v_origen := COALESCE((p->>'cuenta_id')::uuid, v_origen);
    v_destino := COALESCE((p->>'cuenta_destino')::uuid, v_destino);
    IF v_origen = v_destino THEN RAISE EXCEPTION 'Elige dos cuentas distintas'; END IF;
    INSERT INTO movimientos (negocio_id, fecha, cuenta_id, monto, tipo, descripcion, transferencia_id, grupo_id)
    VALUES (m.negocio_id, v_fecha, v_origen, -v_monto, 'transferencia', v_desc, v_clave, v_clave),
           (m.negocio_id, v_fecha, v_destino, v_monto, 'transferencia', v_desc, v_clave, v_clave);
  ELSE
    -- Cobró Didi: con el depósito revertido, lo esperado vuelve a ser el saldo de Didi por cobrar
    v_didi := cuenta_por_clave(m.negocio_id, 'didi');
    v_destino := COALESCE((p->>'cuenta_destino')::uuid, v_destino, cuenta_por_clave(m.negocio_id, 'banco'));
    v_esperado := saldo_cuenta(v_didi);
    v_dif := round(v_monto - v_esperado, 2);
    INSERT INTO movimientos (negocio_id, fecha, cuenta_id, monto, tipo, descripcion, transferencia_id, grupo_id)
    VALUES (m.negocio_id, v_fecha, v_didi, -v_monto, 'cobro_didi', v_desc, v_clave, v_clave),
           (m.negocio_id, v_fecha, v_destino, v_monto, 'cobro_didi', v_desc, v_clave, v_clave);
    IF v_dif <> 0 THEN
      INSERT INTO movimientos (negocio_id, fecha, cuenta_id, monto, tipo, categoria, descripcion, transferencia_id, grupo_id)
      VALUES (m.negocio_id, v_fecha, v_didi, v_dif, 'ajuste_didi', 'didi',
              v_desc || CASE WHEN v_dif < 0 THEN ' · depositó menos de lo esperado' ELSE ' · depositó más de lo esperado' END, v_clave, v_clave);
    END IF;
  END IF;
  RETURN jsonb_build_object('clave', v_clave);
END $$;

CREATE OR REPLACE FUNCTION anular_movimiento(p_mov uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE m movimientos; v_clave uuid;
BEGIN
  SELECT * INTO m FROM movimientos WHERE id = p_mov;
  IF NOT FOUND THEN RAISE EXCEPTION 'Movimiento no encontrado'; END IF;
  IF m.tipo NOT IN ('retiro_dueno','aportacion_dueno','transferencia','cobro_didi','saldo_inicial','ajuste_didi') THEN
    RAISE EXCEPTION 'Este movimiento se elimina desde su origen (Pedidos, Compras, Por pagar o Corte de caja)';
  END IF;
  v_clave := COALESCE(m.grupo_id, m.transferencia_id, m.ref_id, m.id);
  PERFORM revertir_grupo(v_clave, 'Reverso: movimiento anulado');
  UPDATE movimientos SET anulado = true, anulado_at = now()
  WHERE COALESCE(grupo_id, transferencia_id, ref_id, id) = v_clave AND descripcion NOT LIKE 'Reverso%' AND NOT anulado;
END $$;

-- ── 9) Cortes de caja: editar y anular ───────────────────────
CREATE OR REPLACE FUNCTION corte_caja(p_cuenta uuid, p_contado numeric,
                                      p_dia date DEFAULT NULL, p_notas text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_neg uuid; v_dia date := COALESCE(p_dia, dia_operativo(now()));
        v_esperado numeric; v_dif numeric; v_mov uuid; v_id uuid; c cortes_caja;
BEGIN
  SELECT negocio_id INTO v_neg FROM cuentas WHERE id = p_cuenta;
  SELECT * INTO c FROM cortes_caja WHERE negocio_id = v_neg AND cuenta_id = p_cuenta AND dia_operativo = v_dia;
  IF c.id IS NOT NULL AND NOT c.anulado THEN RAISE EXCEPTION 'Ya hay un corte de ese día: tócalo para editarlo'; END IF;
  v_id := COALESCE(c.id, gen_random_uuid());
  v_esperado := saldo_cuenta(p_cuenta, v_dia);
  v_dif := round(p_contado - v_esperado, 2);
  IF v_dif <> 0 THEN
    INSERT INTO movimientos (negocio_id, fecha, cuenta_id, monto, tipo, categoria, descripcion, grupo_id)
    VALUES (v_neg, ts_de_dia(v_dia), p_cuenta, v_dif, 'ajuste_corte',
            CASE WHEN v_dif < 0 THEN 'faltante' ELSE 'sobrante' END,
            COALESCE(p_notas, CASE WHEN v_dif < 0 THEN 'Faltante en corte' ELSE 'Sobrante en corte' END), v_id)
    RETURNING id INTO v_mov;
  END IF;
  IF c.id IS NOT NULL THEN
    UPDATE cortes_caja SET saldo_esperado = v_esperado, saldo_contado = p_contado, diferencia = v_dif,
           movimiento_id = v_mov, notas = p_notas, anulado = false, anulado_at = NULL WHERE id = v_id;
  ELSE
    INSERT INTO cortes_caja (id, negocio_id, dia_operativo, cuenta_id, saldo_esperado, saldo_contado, diferencia, movimiento_id, notas)
    VALUES (v_id, v_neg, v_dia, p_cuenta, v_esperado, p_contado, v_dif, v_mov, p_notas);
  END IF;
  RETURN jsonb_build_object('id', v_id, 'dia', v_dia, 'esperado', v_esperado, 'contado', p_contado, 'diferencia', v_dif);
END $$;

-- Clave del ajuste de un corte (los anteriores a la 08 no tenían grupo_id)
CREATE OR REPLACE FUNCTION clave_corte(c cortes_caja) RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT COALESCE(grupo_id, transferencia_id, ref_id, id) FROM movimientos WHERE id = c.movimiento_id), c.id)
$$;

CREATE OR REPLACE FUNCTION editar_corte(p_corte uuid, p_contado numeric, p_notas text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE c cortes_caja; v_clave uuid; v_esperado numeric; v_dif numeric; v_mov uuid;
BEGIN
  SELECT * INTO c FROM cortes_caja WHERE id = p_corte FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Corte no encontrado'; END IF;
  IF c.anulado THEN RAISE EXCEPTION 'Este corte está anulado'; END IF;
  v_clave := clave_corte(c);
  PERFORM revertir_grupo(v_clave, 'Reverso: corte editado');
  v_esperado := saldo_cuenta(c.cuenta_id, c.dia_operativo);
  v_dif := round(p_contado - v_esperado, 2);
  IF v_dif <> 0 THEN
    INSERT INTO movimientos (negocio_id, fecha, cuenta_id, monto, tipo, categoria, descripcion, grupo_id)
    VALUES (c.negocio_id, ts_de_dia(c.dia_operativo), c.cuenta_id, v_dif, 'ajuste_corte',
            CASE WHEN v_dif < 0 THEN 'faltante' ELSE 'sobrante' END,
            COALESCE(NULLIF(trim(p_notas), ''), CASE WHEN v_dif < 0 THEN 'Faltante en corte' ELSE 'Sobrante en corte' END), v_clave)
    RETURNING id INTO v_mov;
  END IF;
  UPDATE cortes_caja SET saldo_esperado = v_esperado, saldo_contado = p_contado, diferencia = v_dif,
         movimiento_id = COALESCE(v_mov, movimiento_id), notas = NULLIF(trim(p_notas), '')
  WHERE id = p_corte;
  RETURN jsonb_build_object('esperado', v_esperado, 'contado', p_contado, 'diferencia', v_dif);
END $$;

CREATE OR REPLACE FUNCTION anular_corte(p_corte uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE c cortes_caja;
BEGIN
  SELECT * INTO c FROM cortes_caja WHERE id = p_corte FOR UPDATE;
  IF NOT FOUND OR c.anulado THEN RETURN; END IF;
  PERFORM revertir_grupo(clave_corte(c), 'Reverso: corte anulado');
  UPDATE cortes_caja SET anulado = true, anulado_at = now() WHERE id = p_corte;
END $$;

-- ── 10) Inventario: mermas y conteos ─────────────────────────
CREATE OR REPLACE FUNCTION anular_merma(p_mov uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE m inventario_movimientos;
BEGIN
  SELECT * INTO m FROM inventario_movimientos WHERE id = p_mov FOR UPDATE;
  IF NOT FOUND OR m.tipo <> 'merma' THEN RAISE EXCEPTION 'Merma no encontrada'; END IF;
  IF m.anulado THEN RETURN; END IF;
  INSERT INTO inventario_movimientos (negocio_id, insumo_id, fecha, tipo, cantidad, costo_unitario, motivo, ref_tabla, ref_id)
  VALUES (m.negocio_id, m.insumo_id, m.fecha, 'merma', -m.cantidad, m.costo_unitario, 'Reverso: merma anulada', 'inventario_movimientos', m.id);
  UPDATE inventario_movimientos SET anulado = true, anulado_at = now() WHERE id = p_mov;
END $$;

-- Editar merma = anularla y registrar la corregida (cantidad positiva en unidad base)
CREATE OR REPLACE FUNCTION editar_merma(p_mov uuid, p_cantidad numeric, p_motivo text DEFAULT NULL, p_fecha date DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE m inventario_movimientos; v_id uuid;
BEGIN
  SELECT * INTO m FROM inventario_movimientos WHERE id = p_mov;
  IF NOT FOUND OR m.tipo <> 'merma' OR m.anulado THEN RAISE EXCEPTION 'Merma no encontrada'; END IF;
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN RAISE EXCEPTION 'Cantidad inválida'; END IF;
  PERFORM anular_merma(p_mov);
  INSERT INTO inventario_movimientos (negocio_id, insumo_id, fecha, tipo, cantidad, motivo)
  VALUES (m.negocio_id, m.insumo_id, CASE WHEN p_fecha IS NULL THEN m.fecha ELSE ts_de_dia(p_fecha) END,
          'merma', -p_cantidad, COALESCE(NULLIF(trim(p_motivo), ''), m.motivo))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Anular un conteo cerrado: revierte sus ajustes (y arranques) y lo marca anulado
CREATE OR REPLACE FUNCTION anular_conteo(p_conteo uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE c conteos_inventario; ci conteo_items;
BEGIN
  SELECT * INTO c FROM conteos_inventario WHERE id = p_conteo FOR UPDATE;
  IF NOT FOUND OR c.anulado THEN RETURN; END IF;
  IF NOT c.cerrado THEN RAISE EXCEPTION 'El conteo sigue abierto: descártalo'; END IF;
  FOR ci IN SELECT * FROM conteo_items WHERE conteo_id = p_conteo LOOP
    PERFORM revertir_inventario('conteo_items', ci.id, 'Reverso: conteo anulado');
  END LOOP;
  UPDATE conteos_inventario SET anulado = true, anulado_at = now() WHERE id = p_conteo;
END $$;

-- Corregir lo contado de un insumo en un conteo cerrado
CREATE OR REPLACE FUNCTION editar_conteo_item(p_item uuid, p_fisica numeric)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE ci conteo_items; c conteos_inventario; v_cp numeric; v_teo numeric; v_dif numeric; v_val numeric; v_base boolean;
BEGIN
  SELECT * INTO ci FROM conteo_items WHERE id = p_item FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Partida de conteo no encontrada'; END IF;
  SELECT * INTO c FROM conteos_inventario WHERE id = ci.conteo_id;
  IF c.anulado THEN RAISE EXCEPTION 'Este conteo está anulado'; END IF;
  IF p_fisica IS NULL OR p_fisica < 0 THEN RAISE EXCEPTION 'Cantidad inválida'; END IF;
  IF NOT c.cerrado THEN
    UPDATE conteo_items SET cantidad_fisica = p_fisica WHERE id = p_item;
    RETURN jsonb_build_object('abierto', true);
  END IF;
  PERFORM revertir_inventario('conteo_items', p_item, 'Reverso: conteo editado');
  SELECT costo_promedio INTO v_cp FROM insumos WHERE id = ci.insumo_id;
  v_teo := stock_insumo(ci.insumo_id, c.fecha);
  v_dif := p_fisica - v_teo;
  v_base := EXISTS (SELECT 1 FROM inventario_movimientos
                    WHERE insumo_id = ci.insumo_id AND tipo IN ('inicial','ajuste_conteo') AND fecha <= c.fecha
                      AND NOT (ref_tabla = 'conteo_items' AND ref_id = p_item));
  v_val := CASE WHEN v_base THEN round(v_dif * v_cp, 2) ELSE 0 END;
  IF v_dif <> 0 OR NOT v_base THEN
    INSERT INTO inventario_movimientos (negocio_id, insumo_id, fecha, tipo, cantidad, costo_unitario, motivo, ref_tabla, ref_id)
    VALUES (c.negocio_id, ci.insumo_id, c.fecha, CASE WHEN v_base THEN 'ajuste_conteo' ELSE 'inicial' END, v_dif, v_cp,
            CASE WHEN NOT v_base THEN 'Arranque: primer conteo (corregido)'
                 WHEN v_dif < 0 THEN 'Merma por conteo (corregido)' ELSE 'Sobrante por conteo (corregido)' END,
            'conteo_items', p_item);
  END IF;
  UPDATE conteo_items SET cantidad_fisica = p_fisica, cantidad_teorica = v_teo, diferencia = v_dif, valor_diferencia = v_val WHERE id = p_item;
  UPDATE conteos_inventario SET
    valor_diferencia = (SELECT COALESCE(SUM(valor_diferencia), 0) FROM conteo_items WHERE conteo_id = c.id),
    valor_inventario = valor_inventario(c.negocio_id, c.fecha)
  WHERE id = c.id;
  RETURN jsonb_build_object('teorica', v_teo, 'diferencia', v_dif, 'valor', v_val);
END $$;

-- ── 11) Borrar lo que no movió nada; si tiene registros ligados, desactivar ──
CREATE OR REPLACE FUNCTION borrar_o_desactivar(p_tabla text, p_id uuid)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_motivo text;
BEGIN
  IF p_tabla = 'proveedores' THEN
    v_motivo := CASE
      WHEN EXISTS (SELECT 1 FROM compras_insumos WHERE proveedor_id = p_id) THEN 'tiene compras registradas'
      WHEN EXISTS (SELECT 1 FROM obligaciones WHERE proveedor_id = p_id) THEN 'tiene pagos registrados'
      WHEN EXISTS (SELECT 1 FROM insumos WHERE proveedor_id = p_id) THEN 'es proveedor de insumos' END;
    IF v_motivo IS NULL THEN DELETE FROM proveedores WHERE id = p_id;
    ELSE UPDATE proveedores SET activo = false WHERE id = p_id; END IF;
  ELSIF p_tabla = 'gastos_recurrentes' THEN
    v_motivo := CASE WHEN EXISTS (SELECT 1 FROM obligaciones WHERE gasto_recurrente_id = p_id AND (monto_pagado > 0 OR estado = 'pagada'))
                     THEN 'ya tiene pagos hechos' END;
    IF v_motivo IS NULL THEN
      DELETE FROM obligaciones WHERE gasto_recurrente_id = p_id;
      DELETE FROM gastos_recurrentes WHERE id = p_id;
    ELSE UPDATE gastos_recurrentes SET activo = false WHERE id = p_id; END IF;
  ELSIF p_tabla = 'insumos' THEN
    v_motivo := CASE
      WHEN EXISTS (SELECT 1 FROM inventario_movimientos WHERE insumo_id = p_id) THEN 'tiene movimientos de inventario'
      WHEN EXISTS (SELECT 1 FROM recetas WHERE insumo_id = p_id) THEN 'está en recetas'
      WHEN EXISTS (SELECT 1 FROM compra_items WHERE insumo_id = p_id) THEN 'está en compras'
      WHEN EXISTS (SELECT 1 FROM conteo_items WHERE insumo_id = p_id) THEN 'está en conteos' END;
    IF v_motivo IS NULL THEN DELETE FROM insumos WHERE id = p_id;
    ELSE UPDATE insumos SET activo = false WHERE id = p_id; END IF;
  ELSE
    RAISE EXCEPTION 'Tabla no permitida: %', p_tabla;
  END IF;
  RETURN jsonb_build_object('resultado', CASE WHEN v_motivo IS NULL THEN 'borrado' ELSE 'desactivado' END, 'motivo', v_motivo);
END $$;

-- ── 12) Reportes: las compras anuladas no cuentan ───────────
-- food_cost: igual que su última versión (20261029_03_inventario.sql), sin compras anuladas
CREATE OR REPLACE FUNCTION food_cost(p_negocio uuid, p_desde date, p_hasta date)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_venta    numeric;
  v_receta   numeric;
  v_respaldo numeric;
  v_mermas   numeric;
  v_compras  numeric;
  v_teorico  numeric;
  v_real     numeric;
  a          conteos_inventario;
  b          conteos_inventario;
  v_meta     numeric;
BEGIN
  SELECT COALESCE(SUM(monto), 0) INTO v_venta FROM movimientos
  WHERE negocio_id = p_negocio AND tipo = 'venta' AND dia_operativo BETWEEN p_desde AND p_hasta;

  SELECT COALESCE(-SUM(cantidad * costo_unitario) FILTER (WHERE tipo = 'consumo_venta'), 0),
         COALESCE(-SUM(cantidad * costo_unitario) FILTER (WHERE tipo IN ('merma','ajuste_conteo')), 0)
  INTO v_receta, v_mermas
  FROM inventario_movimientos
  WHERE negocio_id = p_negocio AND dia_operativo BETWEEN p_desde AND p_hasta;

  SELECT COALESCE(SUM(pi.cantidad * COALESCE(NULLIF(pi.costo, 0), pr.costo_insumos, 0)), 0) INTO v_respaldo
  FROM pedido_items pi
  JOIN pedidos p ON p.id = pi.pedido_id
  LEFT JOIN productos pr ON pr.id = pi.producto_id
  WHERE p.negocio_id = p_negocio AND p.en_ledger AND NOT p.cancelado
    AND p.fecha BETWEEN p_desde AND p_hasta
    AND NOT EXISTS (SELECT 1 FROM inventario_movimientos m WHERE m.ref_tabla = 'pedido_items' AND m.ref_id = pi.id);

  v_teorico := round(v_receta + v_respaldo, 2);

  -- Anclas: conteo final (día hasta o el siguiente) y, antes de él, el conteo o carga
  -- inicial del arranque (día desde o el anterior).
  SELECT * INTO b FROM conteos_inventario
  WHERE negocio_id = p_negocio AND cerrado AND tipo = 'conteo'
    AND dia_operativo BETWEEN p_hasta AND p_hasta + 1
  ORDER BY fecha DESC LIMIT 1;
  SELECT * INTO a FROM conteos_inventario
  WHERE negocio_id = p_negocio AND cerrado AND dia_operativo BETWEEN p_desde - 1 AND p_desde
    AND (b.id IS NULL OR fecha < b.fecha)
  ORDER BY fecha DESC LIMIT 1;
  IF a.id IS NULL THEN b := NULL; END IF;

  -- Compras = desglosadas (entradas del kardex, entre las anclas si las hay, si no por día)
  --         + compras sin desglose del periodo (son gasto de insumos aunque no muevan inventario)
  SELECT COALESCE(SUM(cantidad * costo_unitario), 0) INTO v_compras
  FROM inventario_movimientos
  WHERE negocio_id = p_negocio AND tipo = 'compra'
    AND CASE WHEN b.id IS NOT NULL THEN fecha > a.fecha AND fecha <= b.fecha
             ELSE dia_operativo BETWEEN p_desde AND p_hasta END;
  v_compras := round(v_compras + (
    SELECT COALESCE(SUM(c.monto), 0) FROM compras_insumos c
    WHERE NOT c.anulado AND c.negocio_id = p_negocio AND c.fecha BETWEEN p_desde AND p_hasta
      AND NOT EXISTS (SELECT 1 FROM compra_items ci WHERE ci.compra_id = c.id)), 2);

  IF a.id IS NOT NULL AND b.id IS NOT NULL THEN
    v_real := round(a.valor_inventario + v_compras - b.valor_inventario, 2);
  ELSE
    v_real := round(v_teorico + v_mermas, 2);
  END IF;

  SELECT meta_food_cost INTO v_meta FROM configuracion_negocio WHERE negocio_id = p_negocio;

  RETURN jsonb_build_object(
    'desde', p_desde, 'hasta', p_hasta,
    'venta_neta', v_venta,
    'consumo_receta', round(v_receta, 2),
    'respaldo_sin_receta', round(v_respaldo, 2),
    'costo_teorico', v_teorico,
    'mermas', round(v_mermas, 2),
    'compras', v_compras,
    'inventario_inicial', a.valor_inventario,
    'inventario_final', b.valor_inventario,
    'costo_real', v_real,
    'estimado', (a.id IS NULL OR b.id IS NULL),
    'fc_teorico', CASE WHEN v_venta > 0 THEN round(v_teorico / v_venta, 4) END,
    'fc_real',    CASE WHEN v_venta > 0 THEN round(v_real / v_venta, 4) END,
    'meta', v_meta
  );
END $$;

-- resumen_periodo: igual que su última versión (20261029_06_dashboard.sql), sin compras anuladas
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
                WHERE NOT anulado AND negocio_id = p_negocio AND fecha BETWEEN p_desde AND p_hasta)
  );
END $$;

-- dashboard: igual que su última versión (20261029_06_dashboard.sql), sin compras anuladas
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
  WHERE NOT anulado AND negocio_id = p_negocio AND fecha BETWEEN v_hoy - 27 AND v_hoy;
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

-- cashflow_proyectado: igual que su última versión (20261030_07_precios_costos.sql), sin compras anuladas
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
  WHERE NOT anulado AND negocio_id = p_negocio AND fecha BETWEEN v_ref - 27 AND v_ref AND metodo_pago IS DISTINCT FROM 'credito';
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

-- ── Permisos ──
ALTER TABLE auditoria_cambios DISABLE ROW LEVEL SECURITY;
GRANT ALL ON auditoria_cambios TO anon, authenticated, service_role;
GRANT SELECT ON v_movimientos_caja TO anon, authenticated, service_role;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;
