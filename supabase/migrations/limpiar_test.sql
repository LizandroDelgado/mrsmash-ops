-- ============================================================
-- MR. SMASH ERP · Limpieza de datos de prueba
-- Borra todo lo que se capturó con descripción/concepto/cliente/notas que empieza con "TEST",
-- incluidos los movimientos que generaron los triggers (ventas, reversos, pagos, ajustes).
-- Es seguro correrlo varias veces. No toca datos reales.
-- ============================================================
BEGIN;

CREATE TEMP TABLE t_ped  ON COMMIT DROP AS
  SELECT id FROM pedidos WHERE cliente_nombre LIKE 'TEST%' OR notas LIKE 'TEST%';
CREATE TEMP TABLE t_comp ON COMMIT DROP AS
  SELECT id FROM compras_insumos WHERE descripcion LIKE 'TEST%';
CREATE TEMP TABLE t_didi ON COMMIT DROP AS
  SELECT id FROM importaciones_didi WHERE didi_order_id::text LIKE 'TEST%';
CREATE TEMP TABLE t_prov ON COMMIT DROP AS
  SELECT id FROM proveedores WHERE nombre LIKE 'TEST%';
CREATE TEMP TABLE t_gr   ON COMMIT DROP AS
  SELECT id FROM gastos_recurrentes WHERE concepto LIKE 'TEST%';
CREATE TEMP TABLE t_obl  ON COMMIT DROP AS
  SELECT id FROM obligaciones
  WHERE concepto LIKE 'TEST%'
     OR proveedor_id        IN (SELECT id FROM t_prov)
     OR gasto_recurrente_id IN (SELECT id FROM t_gr)
     OR compra_id           IN (SELECT id FROM t_comp);
-- Orígenes ya borrados: sus movimientos (venta + reverso) siguen ligados por ref_id
CREATE TEMP TABLE t_ref  ON COMMIT DROP AS
  SELECT DISTINCT ref_id AS id FROM movimientos WHERE ref_id IS NOT NULL AND descripcion LIKE '%TEST%';
CREATE TEMP TABLE t_mov  ON COMMIT DROP AS
  SELECT movimiento_id AS id FROM pagos_obligacion WHERE obligacion_id IN (SELECT id FROM t_obl)
  UNION SELECT movimiento_id FROM cortes_caja WHERE notas LIKE 'TEST%' AND movimiento_id IS NOT NULL;

-- 1) Pagos de obligaciones de prueba (y desbloquear las compras a crédito para poder borrarlas)
DELETE FROM pagos_obligacion WHERE obligacion_id IN (SELECT id FROM t_obl);
UPDATE obligaciones SET monto_pagado = 0 WHERE id IN (SELECT id FROM t_obl);

-- 2) Cortes de prueba
DELETE FROM cortes_caja WHERE notas LIKE 'TEST%';

-- 3) Pedidos y compras de prueba (los triggers generan reversos; se borran en el paso 4)
DELETE FROM pedido_items    WHERE pedido_id IN (SELECT id FROM t_ped);
DELETE FROM pedidos         WHERE id IN (SELECT id FROM t_ped);
DELETE FROM compras_insumos WHERE id IN (SELECT id FROM t_comp);
DELETE FROM importaciones_didi WHERE id IN (SELECT id FROM t_didi);

-- 4) Movimientos: los ligados a lo anterior + transferencias/ajustes/retiros con descripción TEST
DELETE FROM movimientos
WHERE id IN (SELECT id FROM t_mov)
   OR ref_id IN (SELECT id FROM t_ped UNION SELECT id FROM t_comp UNION SELECT id FROM t_obl
                 UNION SELECT id FROM t_didi UNION SELECT id FROM t_ref)
   OR descripcion LIKE 'TEST%'
   OR transferencia_id IN (SELECT transferencia_id FROM movimientos
                           WHERE descripcion LIKE 'TEST%' AND transferencia_id IS NOT NULL);

-- 5) Catálogos de prueba
DELETE FROM obligaciones       WHERE id IN (SELECT id FROM t_obl);
DELETE FROM gastos_recurrentes WHERE id IN (SELECT id FROM t_gr);
DELETE FROM proveedores        WHERE id IN (SELECT id FROM t_prov);

COMMIT;
