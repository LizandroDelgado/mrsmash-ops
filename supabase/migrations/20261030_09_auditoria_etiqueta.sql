-- ════════════════════════════════════════════════════════════
-- 09 · Historial de cambios: etiqueta legible del registro
-- La auditoría guarda sólo los campos que cambiaron; sin esto, una compra anulada
-- o una obligación a la que sólo le cambió el monto aparecían sin nombre.
-- ════════════════════════════════════════════════════════════

ALTER TABLE auditoria_cambios ADD COLUMN IF NOT EXISTS etiqueta text;

-- Nombre con que el dueño reconoce el registro (concepto, descripción, cliente, producto, insumo…)
CREATE OR REPLACE FUNCTION etiqueta_registro(p_tabla text, r jsonb) RETURNS text
LANGUAGE plpgsql STABLE AS $$
DECLARE v text;
BEGIN
  v := COALESCE(NULLIF(r->>'concepto', ''), NULLIF(r->>'descripcion', ''), NULLIF(r->>'nombre', ''),
                NULLIF(r->>'cliente_nombre', ''));
  IF v IS NOT NULL THEN RETURN v; END IF;
  IF p_tabla IN ('pedido_items', 'recetas') THEN
    SELECT nombre INTO v FROM productos WHERE id = (r->>'producto_id')::uuid;
  ELSIF p_tabla IN ('compra_items', 'inventario_movimientos', 'conteo_items') THEN
    SELECT nombre INTO v FROM insumos WHERE id = (r->>'insumo_id')::uuid;
  ELSIF p_tabla = 'pagos_obligacion' THEN
    SELECT concepto INTO v FROM obligaciones WHERE id = (r->>'obligacion_id')::uuid;
  ELSIF p_tabla = 'cortes_caja' THEN
    SELECT nombre INTO v FROM cuentas WHERE id = (r->>'cuenta_id')::uuid;
  ELSIF p_tabla = 'conteos_inventario' THEN
    v := 'del ' || to_char((r->>'fecha')::timestamptz AT TIME ZONE 'America/Mazatlan', 'DD/MM/YYYY');
  END IF;
  RETURN COALESCE(v, NULLIF(r->>'motivo', ''));
END $$;

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
    INSERT INTO auditoria_cambios (negocio_id, tabla, registro_id, accion, antes, etiqueta)
    VALUES (v_neg, TG_TABLE_NAME, NULLIF(v_old->>'id', '')::uuid, 'borrar', v_old, etiqueta_registro(TG_TABLE_NAME, v_old));
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
  INSERT INTO auditoria_cambios (negocio_id, tabla, registro_id, accion, antes, despues, etiqueta)
  VALUES (v_neg, TG_TABLE_NAME, NULLIF(v_new->>'id', '')::uuid, v_acc, v_a, v_d, etiqueta_registro(TG_TABLE_NAME, v_new));
  RETURN NEW;
END $$;

GRANT EXECUTE ON FUNCTION etiqueta_registro(text, jsonb) TO anon, authenticated;
