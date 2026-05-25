-- ============================================================
-- MR. SMASH — GRANTs necesarios para el rol anon en Supabase
-- ============================================================
-- Ejecutar en el SQL Editor de Supabase:
--   https://supabase.com/dashboard/project/effxuvviyhaksllmcrqh/sql
--
-- Nota: RLS está deshabilitado en este proyecto. Sin estos GRANTs
-- el cliente anon (frontend) puede leer pero no escribir/borrar.
-- Las API routes del servidor usan service_role y no necesitan estos
-- GRANTs, pero aplicarlos es buena práctica y permite acceso directo.
-- ============================================================

-- Permisos de SELECT (lectura)
GRANT SELECT ON negocios          TO anon;
GRANT SELECT ON productos         TO anon;
GRANT SELECT ON pedidos           TO anon;
GRANT SELECT ON pedido_items      TO anon;
GRANT SELECT ON compras_insumos   TO anon;
GRANT SELECT ON importaciones_didi TO anon;

-- Permisos de INSERT (crear registros)
GRANT INSERT ON negocios          TO anon;
GRANT INSERT ON productos         TO anon;
GRANT INSERT ON pedidos           TO anon;
GRANT INSERT ON pedido_items      TO anon;
GRANT INSERT ON compras_insumos   TO anon;
GRANT INSERT ON importaciones_didi TO anon;

-- Permisos de UPDATE (cambiar estado de pedidos)
GRANT UPDATE ON pedidos           TO anon;
GRANT UPDATE ON productos         TO anon;

-- Permisos de DELETE (eliminar pedidos e insumos)
GRANT DELETE ON pedidos           TO anon;
GRANT DELETE ON pedido_items      TO anon;
GRANT DELETE ON compras_insumos   TO anon;
GRANT DELETE ON importaciones_didi TO anon;

-- Secuencias (necesario para INSERT con columnas SERIAL/BIGSERIAL)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon;
