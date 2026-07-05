-- ============================================================
-- MR. SMASH — Agregar columna categoria a productos
-- Ejecutar en: https://supabase.com/dashboard/project/effxuvviyhaksllmcrqh/sql
-- ============================================================

ALTER TABLE productos ADD COLUMN IF NOT EXISTS categoria TEXT DEFAULT 'burger';

-- Burgers (smash, bacon, doble)
UPDATE productos SET categoria = 'burger'
WHERE nombre ILIKE '%smash%'
   OR nombre ILIKE '%bacon%'
   OR nombre ILIKE '%doble%';

-- Malteadas
UPDATE productos SET categoria = 'malteada'
WHERE nombre ILIKE '%malteada%';

-- Papas
UPDATE productos SET categoria = 'papas'
WHERE nombre ILIKE '%papas%';

-- Bebidas
UPDATE productos SET categoria = 'bebida'
WHERE nombre ILIKE '%refresco%';

-- Grant lectura para el cliente anon
GRANT SELECT ON productos TO anon;
