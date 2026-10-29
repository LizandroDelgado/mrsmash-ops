-- ============================================================
-- MR. SMASH ERP · Fase 1 · Migración 01: ledger base
-- Aditiva: sólo CREATE / ADD COLUMN. Nada de DROP.
-- ============================================================

-- ── Día operativo ────────────────────────────────────────────
-- Tepic (Nayarit) está en zona Pacífico: America/Mazatlan (UTC-7 todo el año).
-- Corte a las 05:00: 00:00–04:59 cuenta al día anterior.
CREATE OR REPLACE FUNCTION dia_operativo(ts timestamptz)
RETURNS date
LANGUAGE sql STABLE AS $$
  SELECT ((ts AT TIME ZONE 'America/Mazatlan') - interval '5 hours')::date
$$;

-- Timestamp representativo para un día operativo declarado por el usuario:
-- si es hoy, ahora; si es otro día, 20:00 hora local de ese día.
CREATE OR REPLACE FUNCTION ts_de_dia(d date)
RETURNS timestamptz
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN d IS NULL OR d = dia_operativo(now()) THEN now()
    ELSE (d + time '20:00') AT TIME ZONE 'America/Mazatlan'
  END
$$;

-- ── cuentas ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cuentas (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  negocio_id          uuid NOT NULL REFERENCES negocios(id),
  nombre              text NOT NULL,
  tipo                text NOT NULL CHECK (tipo IN ('efectivo','banco','terminal','por_cobrar')),
  clave               text NOT NULL,           -- caja | banco | terminal | didi
  saldo_inicial       numeric(12,2) NOT NULL DEFAULT 0,  -- espejo informativo, ver ERP_PLAN
  fecha_saldo_inicial date,
  activa              boolean NOT NULL DEFAULT true,
  orden               int NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (negocio_id, clave)
);

-- ── movimientos (ledger) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS movimientos (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  negocio_id       uuid NOT NULL REFERENCES negocios(id),
  fecha            timestamptz NOT NULL DEFAULT now(),
  dia_operativo    date NOT NULL,              -- lo llena trg_movimientos_dia con dia_operativo(fecha)
  cuenta_id        uuid NOT NULL REFERENCES cuentas(id),
  monto            numeric(12,2) NOT NULL,     -- + entra, - sale
  monto_bruto      numeric(12,2),              -- Didi: venta bruta (monto_bruto - monto = comisión+promos+retenciones)
  tipo             text NOT NULL CHECK (tipo IN (
                     'venta','cobro_didi','compra_insumo','pago_obligacion','retiro_dueno',
                     'aportacion_dueno','transferencia','ajuste_corte','ajuste_didi','saldo_inicial')),
  categoria        text,
  descripcion      text,
  ref_tabla        text,
  ref_id           uuid,
  transferencia_id uuid,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS movimientos_cuenta_idx ON movimientos (negocio_id, cuenta_id, dia_operativo);
CREATE INDEX IF NOT EXISTS movimientos_ref_idx    ON movimientos (ref_tabla, ref_id);
CREATE INDEX IF NOT EXISTS movimientos_dia_idx    ON movimientos (negocio_id, dia_operativo);

CREATE OR REPLACE FUNCTION trg_movimientos_dia() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.dia_operativo := dia_operativo(NEW.fecha);
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER movimientos_dia BEFORE INSERT OR UPDATE OF fecha ON movimientos
  FOR EACH ROW EXECUTE FUNCTION trg_movimientos_dia();

-- ── proveedores ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS proveedores (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  negocio_id   uuid NOT NULL REFERENCES negocios(id),
  nombre       text NOT NULL,
  telefono     text,
  dias_credito int NOT NULL DEFAULT 0,
  activo       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ── gastos_recurrentes (plantillas OPEX) ─────────────────────
CREATE TABLE IF NOT EXISTS gastos_recurrentes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  negocio_id          uuid NOT NULL REFERENCES negocios(id),
  concepto            text NOT NULL,
  categoria           text NOT NULL DEFAULT 'otro' CHECK (categoria IN
                        ('renta','servicios','nomina','sueldo_dueno','software','mantenimiento','marketing','otro')),
  monto               numeric(12,2) NOT NULL,
  frecuencia          text NOT NULL CHECK (frecuencia IN ('semanal','quincenal','mensual','bimestral')),
  dia_pago            int NOT NULL DEFAULT 1,  -- semanal: ISO 1=lun..7=dom · resto: día del mes
  cuenta_pago_default uuid REFERENCES cuentas(id),
  fecha_inicio        date NOT NULL DEFAULT (dia_operativo(now())),
  activo              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now()
);
-- Sólo un sueldo del dueño por negocio (lo administra configuracion_negocio)
CREATE UNIQUE INDEX IF NOT EXISTS gastos_recurrentes_sueldo_uq
  ON gastos_recurrentes (negocio_id) WHERE categoria = 'sueldo_dueno';

-- ── obligaciones (cuentas por pagar) ─────────────────────────
CREATE TABLE IF NOT EXISTS obligaciones (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  negocio_id          uuid NOT NULL REFERENCES negocios(id),
  concepto            text NOT NULL,
  categoria           text NOT NULL DEFAULT 'otro',
  proveedor_id        uuid REFERENCES proveedores(id),
  monto               numeric(12,2) NOT NULL,
  monto_pagado        numeric(12,2) NOT NULL DEFAULT 0,
  fecha_vencimiento   date NOT NULL,
  estado              text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','parcial','pagada','cancelada')),
  origen              text NOT NULL DEFAULT 'manual' CHECK (origen IN ('recurrente','compra_credito','impuesto','manual')),
  gasto_recurrente_id uuid REFERENCES gastos_recurrentes(id),
  compra_id           uuid,                    -- compras_insumos.id cuando origen = compra_credito
  periodo             text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (gasto_recurrente_id, periodo)
);
CREATE INDEX IF NOT EXISTS obligaciones_pend_idx ON obligaciones (negocio_id, estado, fecha_vencimiento);

-- ── pagos_obligacion ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pagos_obligacion (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  negocio_id    uuid NOT NULL REFERENCES negocios(id),
  obligacion_id uuid NOT NULL REFERENCES obligaciones(id),
  movimiento_id uuid NOT NULL REFERENCES movimientos(id),
  monto         numeric(12,2) NOT NULL,
  fecha         timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ── cortes_caja ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cortes_caja (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  negocio_id     uuid NOT NULL REFERENCES negocios(id),
  dia_operativo  date NOT NULL,
  cuenta_id      uuid NOT NULL REFERENCES cuentas(id),
  saldo_esperado numeric(12,2) NOT NULL,
  saldo_contado  numeric(12,2) NOT NULL,
  diferencia     numeric(12,2) NOT NULL,
  movimiento_id  uuid REFERENCES movimientos(id),
  notas          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (negocio_id, cuenta_id, dia_operativo)
);

-- ── configuracion_negocio ────────────────────────────────────
CREATE TABLE IF NOT EXISTS configuracion_negocio (
  negocio_id                 uuid PRIMARY KEY REFERENCES negocios(id),
  tasa_reserva_impuestos     numeric(5,4)  NOT NULL DEFAULT 0.02,
  dias_reposicion_inventario int           NOT NULL DEFAULT 7,
  meta_food_cost             numeric(5,4)  NOT NULL DEFAULT 0.32,
  sueldo_dueno_semanal       numeric(12,2) NOT NULL DEFAULT 0,
  dia_pago_didi              int           NOT NULL DEFAULT 1,  -- ISO 1=lunes
  hora_corte_dia             int           NOT NULL DEFAULT 5,  -- informativo; dia_operativo() usa 5
  updated_at                 timestamptz   NOT NULL DEFAULT now()
);

-- ── mapeo_productos_externos (para Fase 1b: Soft Restaurant) ─
CREATE TABLE IF NOT EXISTS mapeo_productos_externos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  negocio_id     uuid NOT NULL REFERENCES negocios(id),
  fuente         text NOT NULL,               -- 'soft' | 'didi'
  nombre_externo text NOT NULL,
  producto_id    uuid REFERENCES productos(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (negocio_id, fuente, nombre_externo)
);

-- ── Columnas aditivas en tablas existentes ───────────────────
-- en_ledger: false para los registros históricos (no se contabilizan en retroactivo),
-- los triggers lo ponen en true para todo lo nuevo.
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS metodo_pago   text;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS cuenta_id     uuid REFERENCES cuentas(id);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS fuente_import text NOT NULL DEFAULT 'app';
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS folio_externo text;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS cancelado     boolean NOT NULL DEFAULT false;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS total_bruto   numeric(12,2);  -- Didi: precio plataforma
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS en_ledger     boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS pedidos_folio_externo_uq
  ON pedidos (negocio_id, fuente_import, folio_externo) WHERE folio_externo IS NOT NULL;

ALTER TABLE compras_insumos ADD COLUMN IF NOT EXISTS metodo_pago       text;
ALTER TABLE compras_insumos ADD COLUMN IF NOT EXISTS cuenta_id         uuid REFERENCES cuentas(id);
ALTER TABLE compras_insumos ADD COLUMN IF NOT EXISTS proveedor_id      uuid REFERENCES proveedores(id);
ALTER TABLE compras_insumos ADD COLUMN IF NOT EXISTS fecha_vencimiento date;
ALTER TABLE compras_insumos ADD COLUMN IF NOT EXISTS en_ledger         boolean NOT NULL DEFAULT false;

ALTER TABLE importaciones_didi ADD COLUMN IF NOT EXISTS en_ledger boolean NOT NULL DEFAULT false;

-- ── Semillas (saldos en 0, sin datos inventados) ─────────────
INSERT INTO cuentas (negocio_id, nombre, tipo, clave, orden) VALUES
  ('34797ee1-37fa-4736-ad56-35578a126b08', 'Caja efectivo',           'efectivo',   'caja',     1),
  ('34797ee1-37fa-4736-ad56-35578a126b08', 'Banco',                   'banco',      'banco',    2),
  ('34797ee1-37fa-4736-ad56-35578a126b08', 'Terminal/Transferencias', 'terminal',   'terminal', 3),
  ('34797ee1-37fa-4736-ad56-35578a126b08', 'Didi por cobrar',         'por_cobrar', 'didi',     4)
ON CONFLICT (negocio_id, clave) DO NOTHING;

INSERT INTO configuracion_negocio (negocio_id)
VALUES ('34797ee1-37fa-4736-ad56-35578a126b08')
ON CONFLICT (negocio_id) DO NOTHING;

-- ── Permisos (RLS deshabilitado, mismo esquema que el resto) ─
-- El event trigger `ensure_rls` (rls_auto_enable) activa RLS en toda tabla nueva de public;
-- sin políticas eso bloquearía a anon. Se deshabilita explícitamente, igual que pedidos/insumos.
ALTER TABLE cuentas                  DISABLE ROW LEVEL SECURITY;
ALTER TABLE movimientos              DISABLE ROW LEVEL SECURITY;
ALTER TABLE proveedores              DISABLE ROW LEVEL SECURITY;
ALTER TABLE gastos_recurrentes       DISABLE ROW LEVEL SECURITY;
ALTER TABLE obligaciones             DISABLE ROW LEVEL SECURITY;
ALTER TABLE pagos_obligacion         DISABLE ROW LEVEL SECURITY;
ALTER TABLE cortes_caja              DISABLE ROW LEVEL SECURITY;
ALTER TABLE configuracion_negocio    DISABLE ROW LEVEL SECURITY;
ALTER TABLE mapeo_productos_externos DISABLE ROW LEVEL SECURITY;

GRANT ALL ON cuentas, movimientos, proveedores, gastos_recurrentes, obligaciones,
             pagos_obligacion, cortes_caja, configuracion_negocio, mapeo_productos_externos
  TO anon, authenticated, service_role;
