-- ============================================================
-- MR. SMASH — Insertar "Smash Sencilla Promo" como producto
-- Ejecutar en: https://supabase.com/dashboard/project/effxuvviyhaksllmcrqh/sql
-- ============================================================
-- Primero actualiza el orden de los productos existentes para hacer
-- espacio después de Smash Sencilla (orden 1).
-- Si tus productos ya tienen orden 1, 2, 3... ajusta según corresponda.

-- Empujar hacia abajo los productos con orden >= 2
UPDATE productos
SET orden = orden + 1
WHERE negocio_id = '34797ee1-37fa-4736-ad56-35578a126b08'
  AND orden >= 2;

-- Insertar la variante promo en la posición 2 (justo debajo de Smash Sencilla)
-- Nota: la columna `categoria` no existe en la tabla productos en producción,
-- así que no se incluye aquí (Finanzas usa un fallback por nombre en el frontend).
INSERT INTO productos (negocio_id, nombre, precio_venta, costo_insumos, disponible, orden)
VALUES (
  '34797ee1-37fa-4736-ad56-35578a126b08',
  'Smash Sencilla Promo',
  99,
  49,
  true,
  2
);
