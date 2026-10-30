-- ============================================================
-- MR. SMASH ERP · Fase 2.1 · Migración 04: préstamos, fin de mes, porciones y origen del costo
-- Aditiva. Única excepción: el CHECK de gastos_recurrentes.categoria se reemplaza por uno
-- MÁS AMPLIO (agrega 'prestamo'); Postgres no permite editar un CHECK sin quitarlo y volverlo a poner.
-- ============================================================

-- ── 1) Categoría 'prestamo' ──────────────────────────────────
-- Regla (Fase 3): 'prestamo' NO es OPEX (fuera de utilidad operativa y punto de equilibrio
-- operativo) pero SÍ es dinero comprometido y entra al cashflow.
-- obligaciones.categoria no tiene CHECK (también recibe categorías de compras), no requiere cambio.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT conname FROM pg_constraint
           WHERE conrelid = 'gastos_recurrentes'::regclass AND contype = 'c'
             AND pg_get_constraintdef(oid) LIKE '%categoria%'
  LOOP
    EXECUTE format('ALTER TABLE gastos_recurrentes DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;
ALTER TABLE gastos_recurrentes ADD CONSTRAINT gastos_recurrentes_categoria_check CHECK (categoria IN
  ('renta','servicios','nomina','sueldo_dueno','software','mantenimiento','marketing','prestamo','otro'));

-- ── 2) Pago a fin de mes ─────────────────────────────────────
-- generar_obligaciones ya recorta el día al último día real del mes (LEAST(día, fin de mes)),
-- así que la convención es: dia_pago = 31 = último día del mes (30 nov, 28/29 feb).
COMMENT ON COLUMN gastos_recurrentes.dia_pago IS
  'semanal: ISO 1=lun..7=dom · mensual/bimestral: día del mes, 31 = último día del mes · quincenal: 1..15 (2º pago = +15)';

-- ── 3) Porciones y origen del costo en insumos ───────────────
-- (La 03 ya las crea; se repiten aquí con IF NOT EXISTS para que esta migración documente la Fase 2.1.)
-- gramos_por_porcion: para insumos en 'pza' (porciones) que se compran por kg o litro
-- (mayonesa, catsup…). La pantalla de compras lo pide una vez y lo usa como factor:
-- 1 kg = 1000 / gramos_por_porcion porciones.
ALTER TABLE insumos ADD COLUMN IF NOT EXISTS gramos_por_porcion numeric(12,3);
-- costo_origen: 'excel' = costo de referencia capturado a mano; 'compras' = ya hay compras reales.
ALTER TABLE insumos ADD COLUMN IF NOT EXISTS costo_origen text CHECK (costo_origen IN ('excel','compras'));

-- Notas por línea de receta (ej. "Por confirmar")
ALTER TABLE recetas ADD COLUMN IF NOT EXISTS notas text;

-- La primera compra real cambia el origen del costo a 'compras'
CREATE OR REPLACE FUNCTION trg_inv_mov_costo_origen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE insumos SET costo_origen = 'compras'
  WHERE id = NEW.insumo_id AND costo_origen IS DISTINCT FROM 'compras';
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER inv_mov_costo_origen AFTER INSERT ON inventario_movimientos
  FOR EACH ROW WHEN (NEW.tipo = 'compra' AND NEW.cantidad > 0)
  EXECUTE FUNCTION trg_inv_mov_costo_origen();

-- v_stock_insumos ya expone gramos_por_porcion, costo_origen y contado (definida en la 03).

GRANT EXECUTE ON FUNCTION trg_inv_mov_costo_origen() TO anon, authenticated, service_role;
