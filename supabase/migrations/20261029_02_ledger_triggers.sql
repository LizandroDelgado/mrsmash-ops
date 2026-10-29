-- ============================================================
-- MR. SMASH ERP · Fase 1 · Migración 02: triggers y funciones del ledger
-- Regla: nunca se borran movimientos; se revierten con filas inversas.
-- ============================================================

CREATE OR REPLACE FUNCTION cuenta_por_clave(p_negocio uuid, p_clave text)
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM cuentas WHERE negocio_id = p_negocio AND clave = p_clave
$$;

-- Revierte el neto vigente de todos los movimientos ligados a (ref_tabla, ref_id), por cuenta.
CREATE OR REPLACE FUNCTION revertir_movimientos(p_tabla text, p_ref uuid, p_motivo text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT negocio_id, cuenta_id, tipo, categoria,
           SUM(monto) AS neto, SUM(COALESCE(monto_bruto, 0)) AS bruto,
           bool_or(monto_bruto IS NOT NULL) AS tiene_bruto
    FROM movimientos
    WHERE ref_tabla = p_tabla AND ref_id = p_ref
    GROUP BY negocio_id, cuenta_id, tipo, categoria
    HAVING SUM(monto) <> 0
  LOOP
    INSERT INTO movimientos (negocio_id, cuenta_id, monto, monto_bruto, tipo, categoria, descripcion, ref_tabla, ref_id)
    VALUES (r.negocio_id, r.cuenta_id, -r.neto, CASE WHEN r.tiene_bruto THEN -r.bruto END,
            r.tipo, r.categoria, p_motivo, p_tabla, p_ref);
  END LOOP;
END $$;

-- ════════════════════════════════════════════════════════════
-- PEDIDOS
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION trg_pedidos_before() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.en_ledger := true;
  END IF;
  IF NEW.metodo_pago IS NULL AND NEW.en_ledger THEN
    NEW.metodo_pago := CASE WHEN NEW.canal = 'didi' THEN 'didi' ELSE 'efectivo' END;
  END IF;
  IF NEW.en_ledger AND (TG_OP = 'INSERT' OR NEW.metodo_pago IS DISTINCT FROM OLD.metodo_pago OR NEW.cuenta_id IS NULL) THEN
    NEW.cuenta_id := cuenta_por_clave(NEW.negocio_id, CASE NEW.metodo_pago
      WHEN 'efectivo'      THEN 'caja'
      WHEN 'transferencia' THEN 'terminal'
      WHEN 'tarjeta'       THEN 'terminal'
      WHEN 'didi'          THEN 'didi'
      ELSE 'caja' END);
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER pedidos_before BEFORE INSERT OR UPDATE ON pedidos
  FOR EACH ROW EXECUTE FUNCTION trg_pedidos_before();

CREATE OR REPLACE FUNCTION registrar_venta_pedido(p pedidos) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p.cancelado OR COALESCE(p.total, 0) = 0 OR p.cuenta_id IS NULL THEN RETURN; END IF;
  INSERT INTO movimientos (negocio_id, fecha, cuenta_id, monto, monto_bruto, tipo, categoria, descripcion, ref_tabla, ref_id)
  VALUES (p.negocio_id, ts_de_dia(p.fecha), p.cuenta_id, p.total,
          CASE WHEN p.metodo_pago = 'didi' THEN COALESCE(p.total_bruto, p.total) END,
          'venta', p.canal,
          'Venta ' || COALESCE(p.canal, '') || COALESCE(' · ' || p.cliente_nombre, ''),
          'pedidos', p.id);
END $$;

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
      OR NEW.fecha       IS DISTINCT FROM OLD.fecha) THEN
      PERFORM revertir_movimientos('pedidos', NEW.id,
        CASE WHEN NEW.cancelado AND NOT OLD.cancelado THEN 'Reverso: pedido cancelado'
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
CREATE OR REPLACE TRIGGER pedidos_after AFTER INSERT OR UPDATE OR DELETE ON pedidos
  FOR EACH ROW EXECUTE FUNCTION trg_pedidos_after();

-- ════════════════════════════════════════════════════════════
-- COMPRAS DE INSUMOS
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION trg_compras_before() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_dias int;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.en_ledger := true;
  END IF;
  IF NOT NEW.en_ledger THEN RETURN NEW; END IF;
  IF NEW.metodo_pago IS NULL THEN NEW.metodo_pago := 'efectivo'; END IF;

  IF NEW.metodo_pago = 'credito' THEN
    NEW.cuenta_id := NULL;
    IF NEW.fecha_vencimiento IS NULL THEN
      SELECT dias_credito INTO v_dias FROM proveedores WHERE id = NEW.proveedor_id;
      NEW.fecha_vencimiento := COALESCE(NEW.fecha, dia_operativo(now())) + COALESCE(v_dias, 0);
    END IF;
  ELSIF NEW.cuenta_id IS NULL OR (TG_OP = 'UPDATE' AND NEW.metodo_pago IS DISTINCT FROM OLD.metodo_pago) THEN
    NEW.cuenta_id := cuenta_por_clave(NEW.negocio_id,
      CASE WHEN NEW.metodo_pago = 'transferencia' THEN 'banco' ELSE 'caja' END);
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER compras_before BEFORE INSERT OR UPDATE ON compras_insumos
  FOR EACH ROW EXECUTE FUNCTION trg_compras_before();

CREATE OR REPLACE FUNCTION aplicar_compra(c compras_insumos) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF c.metodo_pago = 'credito' THEN
    INSERT INTO obligaciones (negocio_id, concepto, categoria, proveedor_id, monto,
                              fecha_vencimiento, origen, compra_id)
    VALUES (c.negocio_id, c.descripcion, 'insumos', c.proveedor_id, c.monto,
            c.fecha_vencimiento, 'compra_credito', c.id);
  ELSIF COALESCE(c.monto, 0) <> 0 AND c.cuenta_id IS NOT NULL THEN
    INSERT INTO movimientos (negocio_id, fecha, cuenta_id, monto, tipo, categoria, descripcion, ref_tabla, ref_id)
    VALUES (c.negocio_id, ts_de_dia(c.fecha), c.cuenta_id, -c.monto, 'compra_insumo',
            c.categoria, c.descripcion, 'compras_insumos', c.id);
  END IF;
END $$;

-- Deshace el efecto contable de una compra. Si la obligación de crédito ya tiene
-- pagos, no se puede deshacer en silencio: se bloquea.
CREATE OR REPLACE FUNCTION deshacer_compra(c compras_insumos, p_motivo text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM obligaciones WHERE compra_id = c.id AND estado <> 'cancelada' AND monto_pagado > 0) THEN
    RAISE EXCEPTION 'Esta compra a crédito ya tiene pagos. No se puede cambiar ni borrar.';
  END IF;
  UPDATE obligaciones SET estado = 'cancelada' WHERE compra_id = c.id AND estado <> 'cancelada';
  PERFORM revertir_movimientos('compras_insumos', c.id, p_motivo);
END $$;

CREATE OR REPLACE FUNCTION trg_compras_after() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM aplicar_compra(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.en_ledger AND (
         NEW.monto       IS DISTINCT FROM OLD.monto
      OR NEW.metodo_pago IS DISTINCT FROM OLD.metodo_pago
      OR NEW.cuenta_id   IS DISTINCT FROM OLD.cuenta_id
      OR NEW.proveedor_id IS DISTINCT FROM OLD.proveedor_id
      OR (NEW.fecha IS DISTINCT FROM OLD.fecha AND NEW.metodo_pago <> 'credito')) THEN
      PERFORM deshacer_compra(OLD, 'Reverso: compra editada');
      PERFORM aplicar_compra(NEW);
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.en_ledger THEN
      PERFORM deshacer_compra(OLD, 'Reverso: compra borrada');
    END IF;
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER compras_after AFTER INSERT OR UPDATE OR DELETE ON compras_insumos
  FOR EACH ROW EXECUTE FUNCTION trg_compras_after();

-- ════════════════════════════════════════════════════════════
-- IMPORTACIONES DIDI
-- Fuente de verdad del neto real de Didi. Para no contar doble, si ese día ya hay
-- pedidos Didi capturados en la app (en_ledger), la importación no genera movimiento.
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION trg_didi_after() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.ganancia_neta, 0) <> 0 AND NOT EXISTS (
      SELECT 1 FROM pedidos
      WHERE negocio_id = NEW.negocio_id AND fecha = NEW.fecha
        AND metodo_pago = 'didi' AND en_ledger AND NOT cancelado
    ) THEN
      INSERT INTO movimientos (negocio_id, fecha, cuenta_id, monto, monto_bruto, tipo, categoria, descripcion, ref_tabla, ref_id)
      VALUES (NEW.negocio_id, ts_de_dia(NEW.fecha), cuenta_por_clave(NEW.negocio_id, 'didi'),
              NEW.ganancia_neta, NEW.venta_bruta, 'venta', 'didi',
              'Venta Didi (importada)' || COALESCE(' · ' || NEW.didi_order_id::text, ''),
              'importaciones_didi', NEW.id);
      UPDATE importaciones_didi SET en_ledger = true WHERE id = NEW.id;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.en_ledger THEN
      PERFORM revertir_movimientos('importaciones_didi', OLD.id, 'Reverso: importación Didi borrada');
    END IF;
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER didi_after AFTER INSERT OR DELETE ON importaciones_didi
  FOR EACH ROW EXECUTE FUNCTION trg_didi_after();

-- ════════════════════════════════════════════════════════════
-- SALDOS
-- saldo = SUM(movimientos.monto). El saldo inicial vive como movimiento 'saldo_inicial'
-- (cuentas.saldo_inicial es sólo espejo informativo, no se suma: evita contar doble).
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW v_saldos_cuentas AS
SELECT c.id AS cuenta_id, c.negocio_id, c.nombre, c.tipo, c.clave, c.orden, c.activa,
       c.saldo_inicial, c.fecha_saldo_inicial,
       COALESCE(SUM(m.monto), 0)::numeric(12,2) AS saldo,
       COUNT(m.id) AS num_movimientos
FROM cuentas c
LEFT JOIN movimientos m ON m.cuenta_id = c.id
GROUP BY c.id;

CREATE OR REPLACE FUNCTION saldo_cuenta(p_cuenta uuid, p_hasta_dia date DEFAULT NULL)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(monto), 0) FROM movimientos
  WHERE cuenta_id = p_cuenta AND (p_hasta_dia IS NULL OR dia_operativo <= p_hasta_dia)
$$;

-- Fija el saldo actual de una cuenta a lo que el dueño contó: inserta la diferencia.
CREATE OR REPLACE FUNCTION fijar_saldo_inicial(p_cuenta uuid, p_monto numeric)
RETURNS numeric LANGUAGE plpgsql AS $$
DECLARE v_neg uuid; v_actual numeric; v_delta numeric;
BEGIN
  SELECT negocio_id INTO v_neg FROM cuentas WHERE id = p_cuenta;
  IF v_neg IS NULL THEN RAISE EXCEPTION 'Cuenta no existe'; END IF;
  v_actual := saldo_cuenta(p_cuenta);
  v_delta  := round(p_monto - v_actual, 2);
  IF v_delta <> 0 THEN
    INSERT INTO movimientos (negocio_id, cuenta_id, monto, tipo, descripcion, ref_tabla, ref_id)
    VALUES (v_neg, p_cuenta, v_delta, 'saldo_inicial',
            'Saldo capturado: ' || to_char(p_monto, 'FM999,999,990.00'), 'cuentas', p_cuenta);
  END IF;
  UPDATE cuentas SET saldo_inicial = p_monto, fecha_saldo_inicial = dia_operativo(now()) WHERE id = p_cuenta;
  RETURN v_delta;
END $$;

-- ════════════════════════════════════════════════════════════
-- TESORERÍA
-- ════════════════════════════════════════════════════════════
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

-- Didi depositó p_monto. Se pasa de "Didi por cobrar" a la cuenta destino.
-- Si difiere de lo esperado, la diferencia se ajusta en Didi por cobrar (deja el saldo en 0).
-- Regresa la diferencia (depositado - esperado): negativo = Didi pagó menos.
CREATE OR REPLACE FUNCTION cobrar_didi(p_negocio uuid, p_monto numeric, p_destino uuid DEFAULT NULL,
                                       p_descripcion text DEFAULT 'Depósito Didi')
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_didi uuid; v_dest uuid; v_esperado numeric; v_dif numeric;
BEGIN
  IF p_monto <= 0 THEN RAISE EXCEPTION 'El monto debe ser mayor a 0'; END IF;
  v_didi := cuenta_por_clave(p_negocio, 'didi');
  v_dest := COALESCE(p_destino, cuenta_por_clave(p_negocio, 'banco'));
  v_esperado := saldo_cuenta(v_didi);
  PERFORM transferir(v_didi, v_dest, p_monto, p_descripcion, 'cobro_didi');
  v_dif := round(p_monto - v_esperado, 2);
  IF v_dif <> 0 THEN
    INSERT INTO movimientos (negocio_id, cuenta_id, monto, tipo, categoria, descripcion)
    VALUES (p_negocio, v_didi, v_dif, 'ajuste_didi', 'didi',
            p_descripcion || CASE WHEN v_dif < 0 THEN ' · depositó menos de lo esperado' ELSE ' · depositó más de lo esperado' END);
  END IF;
  RETURN jsonb_build_object('esperado', v_esperado, 'depositado', p_monto, 'diferencia', v_dif);
END $$;

-- Corte de caja del día operativo: esperado = saldo de la cuenta al cierre de ese día.
CREATE OR REPLACE FUNCTION corte_caja(p_cuenta uuid, p_contado numeric,
                                      p_dia date DEFAULT NULL, p_notas text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_neg uuid; v_dia date := COALESCE(p_dia, dia_operativo(now()));
        v_esperado numeric; v_dif numeric; v_mov uuid;
BEGIN
  SELECT negocio_id INTO v_neg FROM cuentas WHERE id = p_cuenta;
  v_esperado := saldo_cuenta(p_cuenta, v_dia);
  v_dif := round(p_contado - v_esperado, 2);
  IF v_dif <> 0 THEN
    INSERT INTO movimientos (negocio_id, fecha, cuenta_id, monto, tipo, categoria, descripcion)
    VALUES (v_neg, ts_de_dia(v_dia), p_cuenta, v_dif, 'ajuste_corte',
            CASE WHEN v_dif < 0 THEN 'faltante' ELSE 'sobrante' END,
            COALESCE(p_notas, CASE WHEN v_dif < 0 THEN 'Faltante en corte' ELSE 'Sobrante en corte' END))
    RETURNING id INTO v_mov;
  END IF;
  INSERT INTO cortes_caja (negocio_id, dia_operativo, cuenta_id, saldo_esperado, saldo_contado, diferencia, movimiento_id, notas)
  VALUES (v_neg, v_dia, p_cuenta, v_esperado, p_contado, v_dif, v_mov, p_notas);
  RETURN jsonb_build_object('dia', v_dia, 'esperado', v_esperado, 'contado', p_contado, 'diferencia', v_dif);
END $$;

-- ════════════════════════════════════════════════════════════
-- OBLIGACIONES
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION pagar_obligacion(p_obligacion uuid, p_cuenta uuid, p_monto numeric)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE o obligaciones; v_mov uuid; v_pagado numeric; v_estado text;
BEGIN
  SELECT * INTO o FROM obligaciones WHERE id = p_obligacion FOR UPDATE;
  IF o.id IS NULL THEN RAISE EXCEPTION 'Obligación no existe'; END IF;
  IF o.estado IN ('pagada','cancelada') THEN RAISE EXCEPTION 'Esta obligación ya está %', o.estado; END IF;
  IF p_monto <= 0 THEN RAISE EXCEPTION 'El monto debe ser mayor a 0'; END IF;
  IF p_monto > o.monto - o.monto_pagado + 0.005 THEN
    RAISE EXCEPTION 'El pago excede lo pendiente (%)', o.monto - o.monto_pagado;
  END IF;

  INSERT INTO movimientos (negocio_id, cuenta_id, monto, tipo, categoria, descripcion, ref_tabla, ref_id)
  VALUES (o.negocio_id, p_cuenta, -p_monto, 'pago_obligacion', o.categoria, o.concepto, 'obligaciones', o.id)
  RETURNING id INTO v_mov;

  INSERT INTO pagos_obligacion (negocio_id, obligacion_id, movimiento_id, monto)
  VALUES (o.negocio_id, o.id, v_mov, p_monto);

  v_pagado := o.monto_pagado + p_monto;
  v_estado := CASE WHEN v_pagado >= o.monto - 0.005 THEN 'pagada' ELSE 'parcial' END;
  UPDATE obligaciones SET monto_pagado = v_pagado, estado = v_estado WHERE id = o.id;
  RETURN jsonb_build_object('estado', v_estado, 'pagado', v_pagado, 'pendiente', o.monto - v_pagado);
END $$;

-- Crea las obligaciones de cada gasto recurrente activo con vencimiento entre
-- max(fecha_inicio, hoy) y p_hasta. Idempotente por UNIQUE(gasto_recurrente_id, periodo).
CREATE OR REPLACE FUNCTION generar_obligaciones(p_negocio uuid, p_hasta date)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE g gastos_recurrentes; v_hoy date := dia_operativo(now());
        v_desde date; v_mes date; v_venc date; v_per text; v_n int := 0; v_ins int;
        v_dow int; v_dia int;
BEGIN
  FOR g IN SELECT * FROM gastos_recurrentes WHERE negocio_id = p_negocio AND activo LOOP
    v_desde := GREATEST(g.fecha_inicio, v_hoy);

    IF g.frecuencia = 'semanal' THEN
      v_dow  := LEAST(GREATEST(g.dia_pago, 1), 7);
      v_venc := v_desde + ((v_dow - EXTRACT(isodow FROM v_desde)::int + 7) % 7);
      WHILE v_venc <= p_hasta LOOP
        v_per := to_char(v_venc, 'IYYY-"W"IW');
        INSERT INTO obligaciones (negocio_id, concepto, categoria, monto, fecha_vencimiento, origen, gasto_recurrente_id, periodo)
        VALUES (p_negocio, g.concepto, g.categoria, g.monto, v_venc, 'recurrente', g.id, v_per)
        ON CONFLICT (gasto_recurrente_id, periodo) DO NOTHING;
        GET DIAGNOSTICS v_ins = ROW_COUNT; v_n := v_n + v_ins;
        v_venc := v_venc + 7;
      END LOOP;
    ELSE
      v_mes := date_trunc('month', v_desde)::date;
      WHILE v_mes <= p_hasta LOOP
        -- bimestral: sólo meses pares respecto al mes de inicio
        IF g.frecuencia <> 'bimestral'
           OR ((EXTRACT(year FROM v_mes)::int * 12 + EXTRACT(month FROM v_mes)::int)
             - (EXTRACT(year FROM g.fecha_inicio)::int * 12 + EXTRACT(month FROM g.fecha_inicio)::int)) % 2 = 0 THEN
          FOR v_dia, v_per IN
            SELECT * FROM (VALUES
              (g.dia_pago, to_char(v_mes, 'YYYY-MM') || CASE WHEN g.frecuencia = 'quincenal' THEN '-Q1' ELSE '' END),
              (CASE WHEN g.frecuencia = 'quincenal' THEN g.dia_pago + 15 END, to_char(v_mes, 'YYYY-MM') || '-Q2')
            ) t(d, p) WHERE d IS NOT NULL
          LOOP
            v_venc := LEAST(v_mes + (GREATEST(v_dia, 1) - 1),
                            (v_mes + interval '1 month' - interval '1 day')::date);
            IF v_venc >= v_desde AND v_venc <= p_hasta THEN
              INSERT INTO obligaciones (negocio_id, concepto, categoria, monto, fecha_vencimiento, origen, gasto_recurrente_id, periodo)
              VALUES (p_negocio, g.concepto, g.categoria, g.monto, v_venc, 'recurrente', g.id, v_per)
              ON CONFLICT (gasto_recurrente_id, periodo) DO NOTHING;
              GET DIAGNOSTICS v_ins = ROW_COUNT; v_n := v_n + v_ins;
            END IF;
          END LOOP;
        END IF;
        v_mes := (v_mes + interval '1 month')::date;
      END LOOP;
    END IF;
  END LOOP;
  RETURN v_n;
END $$;

-- Si cambia una plantilla, actualiza las obligaciones futuras aún sin pagar;
-- si se desactiva, las cancela.
CREATE OR REPLACE FUNCTION trg_gastos_recurrentes_after() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT NEW.activo THEN
    UPDATE obligaciones SET estado = 'cancelada'
    WHERE gasto_recurrente_id = NEW.id AND estado = 'pendiente' AND monto_pagado = 0;
  ELSIF NEW.monto IS DISTINCT FROM OLD.monto OR NEW.concepto IS DISTINCT FROM OLD.concepto
     OR NEW.categoria IS DISTINCT FROM OLD.categoria THEN
    UPDATE obligaciones SET monto = NEW.monto, concepto = NEW.concepto, categoria = NEW.categoria
    WHERE gasto_recurrente_id = NEW.id AND estado = 'pendiente' AND monto_pagado = 0
      AND fecha_vencimiento >= dia_operativo(now());
  END IF;
  -- Si cambió la frecuencia o el día, las pendientes futuras se cancelan y se regeneran
  IF NEW.activo AND (NEW.frecuencia IS DISTINCT FROM OLD.frecuencia OR NEW.dia_pago IS DISTINCT FROM OLD.dia_pago) THEN
    UPDATE obligaciones SET estado = 'cancelada', periodo = periodo || '-x' || substr(id::text, 1, 8)
    WHERE gasto_recurrente_id = NEW.id AND estado = 'pendiente' AND monto_pagado = 0
      AND fecha_vencimiento >= dia_operativo(now());
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER gastos_recurrentes_after AFTER UPDATE ON gastos_recurrentes
  FOR EACH ROW EXECUTE FUNCTION trg_gastos_recurrentes_after();

-- Sueldo del dueño: configuracion_negocio.sueldo_dueno_semanal → gasto recurrente semanal (OPEX).
-- Se paga el día de cierre (lunes, ISO 1). Retiros extra son 'retiro_dueno' y no son gasto.
CREATE OR REPLACE FUNCTION trg_config_sueldo() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.sueldo_dueno_semanal > 0 THEN
    INSERT INTO gastos_recurrentes (negocio_id, concepto, categoria, monto, frecuencia, dia_pago, activo)
    VALUES (NEW.negocio_id, 'Sueldo del dueño', 'sueldo_dueno', NEW.sueldo_dueno_semanal, 'semanal', 1, true)
    ON CONFLICT (negocio_id) WHERE categoria = 'sueldo_dueno'
    DO UPDATE SET monto = EXCLUDED.monto, activo = true;
  ELSE
    UPDATE gastos_recurrentes SET activo = false
    WHERE negocio_id = NEW.negocio_id AND categoria = 'sueldo_dueno' AND activo;
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER config_sueldo BEFORE INSERT OR UPDATE ON configuracion_negocio
  FOR EACH ROW EXECUTE FUNCTION trg_config_sueldo();

GRANT SELECT ON v_saldos_cuentas TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;
