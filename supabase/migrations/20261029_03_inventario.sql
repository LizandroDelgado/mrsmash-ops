-- ============================================================
-- MR. SMASH ERP · Fase 2 · Migración 03: inventario valorizado y recetas
-- Aditiva: sólo CREATE / ADD COLUMN / CREATE OR REPLACE. Nada de DROP.
-- El stock NO se guarda: stock = SUM(inventario_movimientos.cantidad).
-- Los movimientos nunca se borran; se revierten con filas inversas (igual que el ledger).
-- ============================================================

-- ── insumos ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS insumos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  negocio_id     uuid NOT NULL REFERENCES negocios(id),
  nombre         text NOT NULL,
  categoria      text NOT NULL DEFAULT 'otro' CHECK (categoria IN
                   ('carne','pan','lacteos','verdura','salsas','empaque','bebidas','otro')),
  unidad_base    text NOT NULL CHECK (unidad_base IN ('g','ml','pza')),
  costo_promedio numeric(14,6) NOT NULL DEFAULT 0,   -- $ por unidad_base, ponderado (6 decimales: papa a $0.07875/g)
  stock_minimo   numeric(12,3) NOT NULL DEFAULT 0,   -- en unidad_base
  proveedor_id   uuid REFERENCES proveedores(id),
  activo         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);
-- Fase 2.1 (ver migración 04): porciones compradas por peso y origen del costo
ALTER TABLE insumos ADD COLUMN IF NOT EXISTS gramos_por_porcion numeric(12,3);
ALTER TABLE insumos ADD COLUMN IF NOT EXISTS costo_origen text CHECK (costo_origen IN ('excel','compras'));
CREATE UNIQUE INDEX IF NOT EXISTS insumos_nombre_uq ON insumos (negocio_id, lower(nombre)) WHERE activo;

-- ── recetas (BOM por producto) ───────────────────────────────
CREATE TABLE IF NOT EXISTS recetas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  negocio_id  uuid NOT NULL REFERENCES negocios(id),
  producto_id uuid NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  insumo_id   uuid NOT NULL REFERENCES insumos(id),
  cantidad    numeric(12,3) NOT NULL CHECK (cantidad > 0),  -- en unidad_base del insumo
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (producto_id, insumo_id)
);
ALTER TABLE recetas ADD COLUMN IF NOT EXISTS notas text;   -- ej. "Por confirmar"

-- ── inventario_movimientos (kardex) ──────────────────────────
CREATE TABLE IF NOT EXISTS inventario_movimientos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  negocio_id     uuid NOT NULL REFERENCES negocios(id),
  insumo_id      uuid NOT NULL REFERENCES insumos(id),
  fecha          timestamptz NOT NULL DEFAULT now(),
  dia_operativo  date NOT NULL,                 -- lo llena el trigger con dia_operativo(fecha)
  tipo           text NOT NULL CHECK (tipo IN ('inicial','compra','consumo_venta','merma','ajuste_conteo')),
  cantidad       numeric(12,3) NOT NULL,        -- con signo, en unidad_base
  costo_unitario numeric(14,6),                 -- si llega null, toma el costo_promedio vigente
  motivo         text,
  ref_tabla      text,
  ref_id         uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inv_mov_insumo_idx ON inventario_movimientos (insumo_id, fecha);
CREATE INDEX IF NOT EXISTS inv_mov_ref_idx    ON inventario_movimientos (ref_tabla, ref_id);
CREATE INDEX IF NOT EXISTS inv_mov_dia_idx    ON inventario_movimientos (negocio_id, dia_operativo, tipo);

-- ── conteos ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conteos_inventario (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  negocio_id       uuid NOT NULL REFERENCES negocios(id),
  fecha            timestamptz NOT NULL DEFAULT now(),   -- momento del conteo: la teórica se calcula aquí
  dia_operativo    date NOT NULL DEFAULT dia_operativo(now()),
  tipo             text NOT NULL DEFAULT 'conteo' CHECK (tipo IN ('conteo','inicial')),
  notas            text,
  cerrado          boolean NOT NULL DEFAULT false,
  cerrado_at       timestamptz,
  valor_diferencia numeric(12,2),               -- merma (−) o sobrante (+) valorizado
  valor_inventario numeric(12,2),               -- inventario total valorizado al momento del conteo
  created_at       timestamptz NOT NULL DEFAULT now()
);
-- Un solo conteo abierto a la vez
CREATE UNIQUE INDEX IF NOT EXISTS conteos_abierto_uq ON conteos_inventario (negocio_id) WHERE NOT cerrado;

CREATE TABLE IF NOT EXISTS conteo_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  negocio_id       uuid NOT NULL REFERENCES negocios(id),
  conteo_id        uuid NOT NULL REFERENCES conteos_inventario(id) ON DELETE CASCADE,
  insumo_id        uuid NOT NULL REFERENCES insumos(id),
  cantidad_teorica numeric(12,3),               -- se fija al cerrar
  cantidad_fisica  numeric(12,3) NOT NULL,
  diferencia       numeric(12,3),
  valor_diferencia numeric(12,2),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conteo_id, insumo_id)
);

-- ── compra_items (desglose opcional de compras_insumos) ──────
CREATE TABLE IF NOT EXISTS compra_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  negocio_id        uuid NOT NULL REFERENCES negocios(id),
  compra_id         uuid NOT NULL REFERENCES compras_insumos(id) ON DELETE CASCADE,
  insumo_id         uuid NOT NULL REFERENCES insumos(id),
  cantidad          numeric(12,3) NOT NULL CHECK (cantidad > 0),          -- en unidad_compra
  unidad_compra     text NOT NULL,                                        -- kg, g, L, ml, pza, caja…
  factor_conversion numeric(14,6) NOT NULL DEFAULT 1 CHECK (factor_conversion > 0),  -- 1 kg = 1000 g
  costo_total       numeric(12,2) NOT NULL CHECK (costo_total >= 0),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS compra_items_compra_idx ON compra_items (compra_id);

-- ════════════════════════════════════════════════════════════
-- KARDEX: día operativo, costo unitario y costo promedio ponderado
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION trg_inv_mov_before() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_cp    numeric;
  v_stock numeric;
  v_nuevo numeric;
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
    UPDATE insumos SET costo_promedio = round(v_nuevo, 6) WHERE id = NEW.insumo_id;
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER inv_mov_before BEFORE INSERT ON inventario_movimientos
  FOR EACH ROW EXECUTE FUNCTION trg_inv_mov_before();

-- Revierte el neto vigente de los movimientos de inventario ligados a (ref_tabla, ref_id),
-- por insumo y tipo, al costo al que entraron/salieron y EN LA MISMA FECHA del original:
-- cancelar hoy una venta de ayer corrige el consumo de ayer, no el de hoy.
CREATE OR REPLACE FUNCTION revertir_inventario(p_tabla text, p_ref uuid, p_motivo text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT negocio_id, insumo_id, tipo, fecha, SUM(cantidad) AS q, SUM(cantidad * costo_unitario) AS v
    FROM inventario_movimientos
    WHERE ref_tabla = p_tabla AND ref_id = p_ref
    GROUP BY negocio_id, insumo_id, tipo, fecha
    HAVING SUM(cantidad) <> 0
  LOOP
    INSERT INTO inventario_movimientos (negocio_id, insumo_id, fecha, tipo, cantidad, costo_unitario, motivo, ref_tabla, ref_id)
    VALUES (r.negocio_id, r.insumo_id, r.fecha, r.tipo, -r.q, round(r.v / r.q, 6), p_motivo, p_tabla, p_ref);
  END LOOP;
END $$;

-- Stock de un insumo hasta un momento dado (incluido)
CREATE OR REPLACE FUNCTION stock_insumo(p_insumo uuid, p_hasta timestamptz DEFAULT NULL)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(cantidad), 0) FROM inventario_movimientos
  WHERE insumo_id = p_insumo AND (p_hasta IS NULL OR fecha <= p_hasta)
$$;

-- ════════════════════════════════════════════════════════════
-- COMPRAS → entrada a inventario
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION aplicar_compra_item(ci compra_items) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_fecha date;
  v_q     numeric := ci.cantidad * ci.factor_conversion;
BEGIN
  SELECT fecha INTO v_fecha FROM compras_insumos WHERE id = ci.compra_id;
  INSERT INTO inventario_movimientos (negocio_id, insumo_id, fecha, tipo, cantidad, costo_unitario, ref_tabla, ref_id)
  VALUES (ci.negocio_id, ci.insumo_id, ts_de_dia(v_fecha), 'compra', v_q, round(ci.costo_total / v_q, 6),
          'compra_items', ci.id);
END $$;

CREATE OR REPLACE FUNCTION trg_compra_items_before() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.negocio_id IS NULL THEN
    SELECT negocio_id INTO NEW.negocio_id FROM compras_insumos WHERE id = NEW.compra_id;
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER compra_items_before BEFORE INSERT ON compra_items
  FOR EACH ROW EXECUTE FUNCTION trg_compra_items_before();

CREATE OR REPLACE FUNCTION trg_compra_items_after() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM aplicar_compra_item(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM revertir_inventario('compra_items', OLD.id, 'Reverso: compra editada');
    PERFORM aplicar_compra_item(NEW);
  ELSE
    PERFORM revertir_inventario('compra_items', OLD.id, 'Reverso: compra borrada');
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER compra_items_after AFTER INSERT OR UPDATE OR DELETE ON compra_items
  FOR EACH ROW EXECUTE FUNCTION trg_compra_items_after();

-- Si cambia la fecha de la compra, la entrada se re-fecha
CREATE OR REPLACE FUNCTION trg_compras_inventario() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE ci compra_items;
BEGIN
  FOR ci IN SELECT * FROM compra_items WHERE compra_id = NEW.id LOOP
    PERFORM revertir_inventario('compra_items', ci.id, 'Reverso: compra re-fechada');
    PERFORM aplicar_compra_item(ci);
  END LOOP;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER compras_inventario AFTER UPDATE OF fecha ON compras_insumos
  FOR EACH ROW WHEN (NEW.fecha IS DISTINCT FROM OLD.fecha) EXECUTE FUNCTION trg_compras_inventario();

-- ════════════════════════════════════════════════════════════
-- VENTAS → consumo por receta
-- Sólo pedidos del ledger (en_ledger = true): el inventario no reconstruye el histórico.
-- Productos sin receta no consumen nada (y no truenan); /inventario los lista.
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION consumir_item(i pedido_items) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE p pedidos;
BEGIN
  SELECT * INTO p FROM pedidos WHERE id = i.pedido_id;
  IF NOT FOUND OR NOT p.en_ledger OR p.cancelado OR i.producto_id IS NULL OR COALESCE(i.cantidad, 0) = 0 THEN
    RETURN;
  END IF;
  INSERT INTO inventario_movimientos (negocio_id, insumo_id, fecha, tipo, cantidad, ref_tabla, ref_id)
  SELECT p.negocio_id, r.insumo_id, ts_de_dia(p.fecha), 'consumo_venta', -(r.cantidad * i.cantidad),
         'pedido_items', i.id
  FROM recetas r
  WHERE r.producto_id = i.producto_id;
END $$;

CREATE OR REPLACE FUNCTION trg_pedido_items_inventario() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM consumir_item(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.cantidad IS DISTINCT FROM OLD.cantidad OR NEW.producto_id IS DISTINCT FROM OLD.producto_id THEN
      PERFORM revertir_inventario('pedido_items', OLD.id, 'Reverso: partida editada');
      PERFORM consumir_item(NEW);
    END IF;
  ELSE
    PERFORM revertir_inventario('pedido_items', OLD.id, 'Reverso: partida borrada');
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER pedido_items_inventario AFTER INSERT OR UPDATE OR DELETE ON pedido_items
  FOR EACH ROW EXECUTE FUNCTION trg_pedido_items_inventario();

-- Cancelar / reactivar / re-fechar un pedido: revierte y, si sigue vigente, vuelve a consumir
CREATE OR REPLACE FUNCTION trg_pedidos_inventario() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE i pedido_items;
BEGIN
  IF NOT NEW.en_ledger THEN RETURN NEW; END IF;
  FOR i IN SELECT * FROM pedido_items WHERE pedido_id = NEW.id LOOP
    PERFORM revertir_inventario('pedido_items', i.id,
      CASE WHEN NEW.cancelado AND NOT OLD.cancelado THEN 'Reverso: pedido cancelado' ELSE 'Reverso: pedido editado' END);
    PERFORM consumir_item(i);
  END LOOP;
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER pedidos_inventario AFTER UPDATE OF cancelado, fecha ON pedidos
  FOR EACH ROW WHEN (NEW.cancelado IS DISTINCT FROM OLD.cancelado OR NEW.fecha IS DISTINCT FROM OLD.fecha)
  EXECUTE FUNCTION trg_pedidos_inventario();

-- ════════════════════════════════════════════════════════════
-- VISTAS
-- ════════════════════════════════════════════════════════════
-- Stock, valor y cobertura. Consumo diario = consumo neto de los últimos 14 días
-- entre los días que abre el negocio (martes a domingo) desde el primer consumo registrado.
CREATE OR REPLACE VIEW v_stock_insumos AS
WITH hoy AS (SELECT dia_operativo(now()) AS d),
mov AS (
  SELECT m.insumo_id,
         SUM(m.cantidad) AS stock,
         -SUM(m.cantidad) FILTER (WHERE m.tipo = 'consumo_venta' AND m.dia_operativo > (SELECT d FROM hoy) - 14) AS consumo14,
         MIN(m.dia_operativo) FILTER (WHERE m.tipo = 'consumo_venta') AS primer_consumo
  FROM inventario_movimientos m
  GROUP BY m.insumo_id
),
base AS (
  SELECT i.*, COALESCE(m.stock, 0) AS stock, COALESCE(m.consumo14, 0) AS consumo14,
         (SELECT count(*) FROM generate_series(GREATEST((SELECT d FROM hoy) - 13, m.primer_consumo),
                                               (SELECT d FROM hoy), interval '1 day') g
          WHERE extract(isodow FROM g) <> 1) AS dias_abiertos
  FROM insumos i
  LEFT JOIN mov m ON m.insumo_id = i.id
)
SELECT b.id AS insumo_id, b.negocio_id, b.nombre, b.categoria, b.unidad_base, b.costo_promedio,
       b.stock_minimo, b.proveedor_id, b.activo,
       b.stock,
       round(b.stock * b.costo_promedio, 2) AS valor,
       CASE WHEN b.consumo14 > 0 AND b.dias_abiertos > 0 THEN round(b.consumo14 / b.dias_abiertos, 3) END AS consumo_diario,
       CASE WHEN b.consumo14 > 0 AND b.dias_abiertos > 0
            THEN round(GREATEST(b.stock, 0) / (b.consumo14 / b.dias_abiertos), 1) END AS dias_cobertura,
       (b.stock_minimo > 0 AND b.stock < b.stock_minimo) AS bajo_minimo,
       b.gramos_por_porcion, b.costo_origen,
       -- contado = ya tiene punto de partida (carga inicial o conteo); si no, su stock aún no es real
       EXISTS (SELECT 1 FROM inventario_movimientos x
               WHERE x.insumo_id = b.id AND x.tipo IN ('inicial','ajuste_conteo')) AS contado
FROM base b;

-- Costo actual de cada producto según su receta, contra productos.costo_insumos
CREATE OR REPLACE VIEW v_costo_receta AS
SELECT p.id AS producto_id, p.negocio_id, p.nombre, p.precio_venta, p.costo_insumos, p.disponible, p.orden,
       count(r.id) AS n_insumos,
       round(COALESCE(SUM(r.cantidad * i.costo_promedio), 0), 2) AS costo_receta,
       CASE WHEN count(r.id) > 0
            THEN round(SUM(r.cantidad * i.costo_promedio), 2) - p.costo_insumos END AS diferencia,
       COALESCE(bool_or(i.costo_promedio = 0), false) AS insumo_sin_costo
FROM productos p
LEFT JOIN recetas r ON r.producto_id = p.id
LEFT JOIN insumos i ON i.id = r.insumo_id
GROUP BY p.id;

-- ════════════════════════════════════════════════════════════
-- RPC
-- ════════════════════════════════════════════════════════════
-- Valor del inventario de un negocio en un momento: stock a esa fecha × costo promedio vigente
CREATE OR REPLACE FUNCTION valor_inventario(p_negocio uuid, p_hasta timestamptz DEFAULT NULL)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT round(COALESCE(SUM(s.q * i.costo_promedio), 0), 2)
  FROM insumos i
  JOIN LATERAL (SELECT stock_insumo(i.id, p_hasta) AS q) s ON true
  WHERE i.negocio_id = p_negocio AND i.activo
$$;

-- Carga inicial en lote: da de alta insumos y su stock (movimiento 'inicial') en una sola transacción.
-- p_items: [{nombre, categoria, unidad_base, stock, costo_unitario, stock_minimo, proveedor_id}]
-- stock, costo_unitario y stock_minimo vienen en unidad_base.
CREATE OR REPLACE FUNCTION carga_inicial(p_negocio uuid, p_items jsonb, p_notas text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  it      jsonb;
  v_id    uuid;
  v_stock numeric;
  v_costo numeric;
  v_n     int := 0;
  v_cont  uuid;
  v_ts    timestamptz := now();
BEGIN
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_stock := COALESCE((it->>'stock')::numeric, 0);
    v_costo := COALESCE((it->>'costo_unitario')::numeric, 0);
    BEGIN
      INSERT INTO insumos (negocio_id, nombre, categoria, unidad_base, costo_promedio, stock_minimo, proveedor_id)
      VALUES (p_negocio, trim(it->>'nombre'), COALESCE(it->>'categoria', 'otro'), it->>'unidad_base',
              CASE WHEN v_stock > 0 THEN 0 ELSE v_costo END,
              COALESCE((it->>'stock_minimo')::numeric, 0), NULLIF(it->>'proveedor_id', '')::uuid)
      RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'Ya existe un insumo llamado "%"', trim(it->>'nombre');
    END;
    IF v_stock > 0 THEN
      INSERT INTO inventario_movimientos (negocio_id, insumo_id, fecha, tipo, cantidad, costo_unitario, motivo)
      VALUES (p_negocio, v_id, v_ts, 'inicial', v_stock, v_costo, COALESCE(p_notas, 'Carga inicial'));
    END IF;
    v_n := v_n + 1;
  END LOOP;

  -- Queda como "conteo" cerrado de tipo inicial: es el punto de partida para el food cost real
  INSERT INTO conteos_inventario (negocio_id, fecha, dia_operativo, tipo, notas, cerrado, cerrado_at, valor_diferencia, valor_inventario)
  VALUES (p_negocio, v_ts, dia_operativo(v_ts), 'inicial', COALESCE(p_notas, 'Carga inicial'), true, v_ts, 0,
          valor_inventario(p_negocio, v_ts))
  RETURNING id INTO v_cont;

  RETURN jsonb_build_object('insumos', v_n, 'conteo_id', v_cont, 'valor_inventario', valor_inventario(p_negocio, v_ts));
END $$;

-- ¿El insumo ya tiene un punto de partida (carga inicial o conteo cerrado) antes de p_hasta?
-- Si no, su primer conteo es el ARRANQUE del stock, no merma ni sobrante.
CREATE OR REPLACE FUNCTION insumo_tiene_base(p_insumo uuid, p_hasta timestamptz)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM inventario_movimientos
                 WHERE insumo_id = p_insumo AND tipo IN ('inicial','ajuste_conteo') AND fecha <= p_hasta)
$$;

-- Resumen de un conteo (abierto o cerrado): teórica al momento del conteo, física, diferencia y su valor.
-- arranque = primer conteo del insumo: la diferencia fija el stock inicial y no cuenta como merma.
CREATE OR REPLACE FUNCTION resumen_conteo(p_conteo uuid)
RETURNS TABLE (insumo_id uuid, nombre text, unidad_base text, categoria text, costo_promedio numeric,
               cantidad_teorica numeric, cantidad_fisica numeric, diferencia numeric, valor_diferencia numeric,
               arranque boolean)
LANGUAGE sql STABLE AS $$
  SELECT ci.insumo_id, i.nombre, i.unidad_base, i.categoria, i.costo_promedio,
         COALESCE(ci.cantidad_teorica, stock_insumo(ci.insumo_id, c.fecha)) AS cantidad_teorica,
         ci.cantidad_fisica,
         COALESCE(ci.diferencia, ci.cantidad_fisica - stock_insumo(ci.insumo_id, c.fecha)) AS diferencia,
         CASE WHEN m.arranque THEN 0
              ELSE COALESCE(ci.valor_diferencia,
                   round((ci.cantidad_fisica - stock_insumo(ci.insumo_id, c.fecha)) * i.costo_promedio, 2)) END AS valor_diferencia,
         m.arranque
  FROM conteo_items ci
  JOIN conteos_inventario c ON c.id = ci.conteo_id
  JOIN insumos i ON i.id = ci.insumo_id
  LEFT JOIN LATERAL (
    -- Cerrado: arranque si su ajuste quedó como 'inicial'. Abierto: si no tiene base antes del conteo.
    SELECT CASE WHEN c.cerrado
                THEN EXISTS (SELECT 1 FROM inventario_movimientos mm
                             WHERE mm.ref_tabla = 'conteo_items' AND mm.ref_id = ci.id AND mm.tipo = 'inicial')
                ELSE NOT insumo_tiene_base(ci.insumo_id, c.fecha) END AS arranque
  ) m ON true
  WHERE ci.conteo_id = p_conteo
  ORDER BY i.categoria, i.nombre
$$;

-- Cierra un conteo: fija la teórica, registra el ajuste por la diferencia (merma o sobrante)
-- y guarda el inventario valorizado para el food cost real.
CREATE OR REPLACE FUNCTION cerrar_conteo(p_conteo uuid)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  c       conteos_inventario;
  r       record;
  v_teo   numeric;
  v_dif   numeric;
  v_val   numeric;
  v_total numeric := 0;
  v_n     int := 0;
  v_base  boolean;
BEGIN
  SELECT * INTO c FROM conteos_inventario WHERE id = p_conteo FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conteo no encontrado'; END IF;
  IF c.cerrado THEN RAISE EXCEPTION 'Este conteo ya está cerrado'; END IF;

  FOR r IN SELECT ci.id, ci.insumo_id, ci.cantidad_fisica, i.costo_promedio
           FROM conteo_items ci JOIN insumos i ON i.id = ci.insumo_id
           WHERE ci.conteo_id = p_conteo LOOP
    v_teo  := stock_insumo(r.insumo_id, c.fecha);
    v_dif  := r.cantidad_fisica - v_teo;
    v_base := insumo_tiene_base(r.insumo_id, c.fecha);
    -- Primer conteo del insumo: la diferencia es el arranque del stock (tipo 'inicial'), no merma
    v_val  := CASE WHEN v_base THEN round(v_dif * r.costo_promedio, 2) ELSE 0 END;
    UPDATE conteo_items SET cantidad_teorica = v_teo, diferencia = v_dif, valor_diferencia = v_val WHERE id = r.id;
    IF v_dif <> 0 OR NOT v_base THEN
      INSERT INTO inventario_movimientos (negocio_id, insumo_id, fecha, tipo, cantidad, costo_unitario, motivo, ref_tabla, ref_id)
      VALUES (c.negocio_id, r.insumo_id, c.fecha, CASE WHEN v_base THEN 'ajuste_conteo' ELSE 'inicial' END, v_dif, r.costo_promedio,
              CASE WHEN NOT v_base THEN 'Arranque: primer conteo'
                   WHEN v_dif < 0 THEN 'Merma por conteo' ELSE 'Sobrante por conteo' END, 'conteo_items', r.id);
    END IF;
    v_total := v_total + v_val;
    v_n := v_n + 1;
  END LOOP;

  UPDATE conteos_inventario
  SET cerrado = true, cerrado_at = now(), valor_diferencia = v_total,
      valor_inventario = valor_inventario(c.negocio_id, c.fecha)
  WHERE id = p_conteo;

  RETURN jsonb_build_object('insumos', v_n, 'valor_diferencia', v_total,
                            'valor_inventario', valor_inventario(c.negocio_id, c.fecha));
END $$;

-- Food cost del periodo [p_desde, p_hasta] (días operativos).
--   teórico = consumo por receta valorizado + respaldo (pedido_items.costo, que viene de
--             productos.costo_insumos, para lo vendido sin receta) / venta neta
--   real    = (inventario inicial + compras − inventario final) / venta neta, si hay conteo
--             (o carga inicial) al arrancar el periodo y conteo al terminarlo;
--             si no, teórico + mermas y ajustes registrados, marcado como estimado.
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
    WHERE c.negocio_id = p_negocio AND c.fecha BETWEEN p_desde AND p_hasta
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

-- ── Permisos (RLS deshabilitado; ver hallazgo ensure_rls en ERP_PLAN) ─
ALTER TABLE insumos                DISABLE ROW LEVEL SECURITY;
ALTER TABLE recetas                DISABLE ROW LEVEL SECURITY;
ALTER TABLE inventario_movimientos DISABLE ROW LEVEL SECURITY;
ALTER TABLE conteos_inventario     DISABLE ROW LEVEL SECURITY;
ALTER TABLE conteo_items           DISABLE ROW LEVEL SECURITY;
ALTER TABLE compra_items           DISABLE ROW LEVEL SECURITY;

GRANT ALL ON insumos, recetas, inventario_movimientos, conteos_inventario, conteo_items, compra_items
  TO anon, authenticated, service_role;
GRANT SELECT ON v_stock_insumos, v_costo_receta TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION stock_insumo(uuid, timestamptz), valor_inventario(uuid, timestamptz),
  carga_inicial(uuid, jsonb, text), resumen_conteo(uuid), cerrar_conteo(uuid), food_cost(uuid, date, date)
  TO anon, authenticated, service_role;
