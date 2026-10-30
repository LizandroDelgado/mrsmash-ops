-- ============================================================
-- MR. SMASH ERP · Fase 2.1 · Migración 05: semilla REAL (datos del dueño, 2026-10-29)
-- Insumos con costo de referencia (costo_origen 'excel'), SIN stock: el stock arranca con el
-- primer conteo. Recetas mapeadas por nombre de producto. Gastos fijos mensuales.
-- Idempotente: no duplica insumos (nombre sin distinguir mayúsculas), recetas ni gastos (concepto).
-- ============================================================

-- ── Insumos (costo por unidad_base) ──────────────────────────
INSERT INTO insumos (negocio_id, nombre, categoria, unidad_base, costo_promedio, costo_origen)
SELECT '34797ee1-37fa-4736-ad56-35578a126b08', v.nombre, v.categoria, v.unidad, v.costo, 'excel'
FROM (VALUES
  ('Pan brioche',               'pan',     'pza', 11.75),
  ('Carne smash',               'carne',   'g',   0.195),     -- bola 80 g = $15.60
  ('Queso amarillo (rebanada)', 'lacteos', 'pza', 3.25),
  ('Tocino (tira)',             'carne',   'pza', 4.00),
  ('Cebolla (porción)',         'verdura', 'pza', 0.40),
  ('Chile güero',               'verdura', 'pza', 1.15),
  ('Mayonesa (porción)',        'salsas',  'pza', 2.85),
  ('Catsup (porción)',          'salsas',  'pza', 0.65),
  ('Mostaza (porción)',         'salsas',  'pza', 0.25),
  ('Miel (porción)',            'salsas',  'pza', 1.00),
  ('Papa congelada',            'otro',    'g',   0.07875),
  ('Aceite (porción freidora)', 'otro',    'pza', 2.23),
  ('Bolsa',                     'empaque', 'pza', 4.20),
  ('Papel envoltura',           'empaque', 'pza', 0.65),
  ('Aluminio',                  'empaque', 'pza', 0.50),
  ('Vaso papas',                'empaque', 'pza', 1.80),
  ('Nieve Holanda',             'lacteos', 'g',   0.0415),
  ('Leche',                     'lacteos', 'ml',  0.021),
  ('Vaso malteada',             'empaque', 'pza', 1.40),
  ('Tapa malteada',             'empaque', 'pza', 1.35),
  ('Refresco',                  'bebidas', 'pza', 20.00)
) AS v(nombre, categoria, unidad, costo)
WHERE NOT EXISTS (
  SELECT 1 FROM insumos i
  WHERE i.negocio_id = '34797ee1-37fa-4736-ad56-35578a126b08' AND i.activo AND lower(i.nombre) = lower(v.nombre));

-- ── Recetas ──────────────────────────────────────────────────
-- Base de toda burger (todas incluyen papas). "Papas Sencillas" = producto "Papas a la francesa"
-- (confirmado por el dueño). Malteadas sin jarabe.
CREATE TEMP TABLE semilla_recetas (producto text, insumo text, cantidad numeric, notas text) ON COMMIT DROP;

INSERT INTO semilla_recetas
SELECT p.producto, b.insumo, b.cantidad, NULL
FROM unnest(ARRAY['Smash Sencilla','Smash Sencilla Promo','Bacon Smash','Doble Smash','Doble Bacon Smash']) AS p(producto)
CROSS JOIN (VALUES
  ('Pan brioche', 1), ('Cebolla (porción)', 1), ('Mayonesa (porción)', 1), ('Catsup (porción)', 1),
  ('Mostaza (porción)', 1), ('Chile güero', 1), ('Miel (porción)', 1), ('Bolsa', 1), ('Papel envoltura', 1),
  ('Aluminio', 1), ('Papa congelada', 80), ('Aceite (porción freidora)', 1), ('Vaso papas', 1)
) AS b(insumo, cantidad);

INSERT INTO semilla_recetas VALUES
  ('Smash Sencilla',       'Carne smash', 80,  NULL), ('Smash Sencilla',       'Queso amarillo (rebanada)', 1, NULL),
  ('Smash Sencilla Promo', 'Carne smash', 80,  NULL), ('Smash Sencilla Promo', 'Queso amarillo (rebanada)', 1, NULL),
  ('Bacon Smash',          'Carne smash', 80,  NULL), ('Bacon Smash',          'Queso amarillo (rebanada)', 1, NULL),
  ('Bacon Smash',          'Tocino (tira)', 2, NULL),
  ('Doble Smash',          'Carne smash', 160, NULL), ('Doble Smash',          'Queso amarillo (rebanada)', 2, NULL),
  ('Doble Bacon Smash',    'Carne smash', 160, NULL), ('Doble Bacon Smash',    'Queso amarillo (rebanada)', 2, NULL),
  ('Doble Bacon Smash',    'Tocino (tira)', 2, NULL);

INSERT INTO semilla_recetas
SELECT m.producto, x.insumo, x.cantidad, NULL
FROM unnest(ARRAY['Malteada Vainilla','Malteada Fresa','Malteada Chocolate']) AS m(producto)
CROSS JOIN (VALUES ('Nieve Holanda', 400), ('Leche', 250), ('Vaso malteada', 1), ('Tapa malteada', 1)) AS x(insumo, cantidad);

INSERT INTO semilla_recetas VALUES
  ('Papas a la francesa', 'Papa congelada', 80, NULL),
  ('Papas a la francesa', 'Aceite (porción freidora)', 1, NULL),
  ('Papas a la francesa', 'Vaso papas', 1, NULL),
  ('Papas Smash', 'Papa congelada', 80, NULL),
  ('Papas Smash', 'Aceite (porción freidora)', 1, NULL),
  ('Papas Smash', 'Vaso papas', 1, NULL),
  ('Papas Smash', 'Tocino (tira)', 2.625, 'Por confirmar'),
  ('Papas Smash', 'Cebolla (porción)', 2.5, NULL),
  ('Refresco', 'Refresco', 1, NULL);

-- Si falta un producto o insumo, la migración falla completa (no se crean productos)
DO $$
DECLARE v_faltan text;
BEGIN
  SELECT string_agg(DISTINCT s.producto, ', ') INTO v_faltan FROM semilla_recetas s
  WHERE NOT EXISTS (SELECT 1 FROM productos p
                    WHERE p.negocio_id = '34797ee1-37fa-4736-ad56-35578a126b08' AND p.nombre = s.producto);
  IF v_faltan IS NOT NULL THEN RAISE EXCEPTION 'Productos no encontrados: %', v_faltan; END IF;
  SELECT string_agg(DISTINCT s.insumo, ', ') INTO v_faltan FROM semilla_recetas s
  WHERE NOT EXISTS (SELECT 1 FROM insumos i
                    WHERE i.negocio_id = '34797ee1-37fa-4736-ad56-35578a126b08' AND i.activo AND i.nombre = s.insumo);
  IF v_faltan IS NOT NULL THEN RAISE EXCEPTION 'Insumos no encontrados: %', v_faltan; END IF;
END $$;

INSERT INTO recetas (negocio_id, producto_id, insumo_id, cantidad, notas)
SELECT '34797ee1-37fa-4736-ad56-35578a126b08', p.id, i.id, s.cantidad, s.notas
FROM semilla_recetas s
JOIN productos p ON p.negocio_id = '34797ee1-37fa-4736-ad56-35578a126b08' AND p.nombre = s.producto
JOIN insumos  i ON i.negocio_id = '34797ee1-37fa-4736-ad56-35578a126b08' AND i.activo AND i.nombre = s.insumo
ON CONFLICT (producto_id, insumo_id) DO NOTHING;

-- ── Gastos fijos: mensuales, último día del mes (dia_pago 31), se pagan del Banco ──
INSERT INTO gastos_recurrentes (negocio_id, concepto, categoria, monto, frecuencia, dia_pago, cuenta_pago_default)
SELECT '34797ee1-37fa-4736-ad56-35578a126b08', v.concepto, v.categoria, v.monto, 'mensual', 31,
       cuenta_por_clave('34797ee1-37fa-4736-ad56-35578a126b08', 'banco')
FROM (VALUES
  ('Luz',               'servicios', 600),
  ('Gas',               'servicios', 900),
  ('Renta',             'renta',     6000),
  ('Empleados',         'nomina',    10000),
  ('Marketing',         'marketing', 2500),
  ('Publicidad',        'marketing', 1000),
  ('Préstamo Olga',     'prestamo',  3200),
  ('Préstamo Cristian', 'prestamo',  4600)
) AS v(concepto, categoria, monto)
WHERE NOT EXISTS (
  SELECT 1 FROM gastos_recurrentes g
  WHERE g.negocio_id = '34797ee1-37fa-4736-ad56-35578a126b08' AND lower(trim(g.concepto)) = lower(v.concepto));
