-- ============================================================
-- MR. SMASH — Agregar columna categoria a productos
-- Ejecutar en: https://supabase.com/dashboard/project/effxuvviyhaksllmcrqh/sql
-- ============================================================

ALTER TABLE productos ADD COLUMN IF NOT EXISTS categoria TEXT DEFAULT 'burger';

-- Malteadas
UPDATE productos SET categoria = 'malteada'
WHERE nombre ILIKE '%malteada%';

-- Papas
UPDATE productos SET categoria = 'papas'
WHERE nombre ILIKE '%papas%' OR nombre ILIKE '%francesa%';

-- Bebidas
UPDATE productos SET categoria = 'bebida'
WHERE nombre ILIKE '%refresco%';

-- Burgers (asegurar el default)
UPDATE productos SET categoria = 'burger'
WHERE nombre IN ('Smash Sencilla', 'Bacon Smash', 'Doble Smash', 'Doble Bacon Smash');

-- Grant para que el cliente anon pueda leer la nueva columna
GRANT SELECT ON productos TO anon;
