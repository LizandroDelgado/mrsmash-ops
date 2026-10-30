// Single-tenant: mismo negocio_id que usan /dashboard e /importar-didi.
export const NEGOCIO_ID = '34797ee1-37fa-4736-ad56-35578a126b08';

export const METODOS_VENTA = [
  { key: 'efectivo',      label: 'Efectivo' },
  { key: 'transferencia', label: 'Transfer.' },
  { key: 'tarjeta',       label: 'Tarjeta' },
];

export const METODOS_COMPRA = [
  { key: 'efectivo',      label: 'Efectivo' },
  { key: 'transferencia', label: 'Transfer.' },
  { key: 'credito',       label: 'A crédito' },
];

export const CATEGORIAS_GASTO = [
  { key: 'renta',         label: 'Renta' },
  { key: 'servicios',     label: 'Servicios' },
  { key: 'nomina',        label: 'Nómina' },
  { key: 'software',      label: 'Software' },
  { key: 'mantenimiento', label: 'Mantenim.' },
  { key: 'marketing',     label: 'Marketing' },
  { key: 'prestamo',      label: 'Pago de préstamo' },  // no es OPEX: fuera de utilidad operativa (ver ERP_PLAN)
  { key: 'otro',          label: 'Otro' },
];

export const FRECUENCIAS = [
  { key: 'semanal',   label: 'Semanal' },
  { key: 'quincenal', label: 'Quincenal' },
  { key: 'mensual',   label: 'Mensual' },
  { key: 'bimestral', label: 'Bimestral' },
];

export const DIAS_SEMANA_ISO = [
  { key: 1, label: 'Lun' }, { key: 2, label: 'Mar' }, { key: 3, label: 'Mié' },
  { key: 4, label: 'Jue' }, { key: 5, label: 'Vie' }, { key: 6, label: 'Sáb' }, { key: 7, label: 'Dom' },
];

export const TIPOS_MOVIMIENTO = {
  venta:            'Venta',
  cobro_didi:       'Cobro Didi',
  compra_insumo:    'Compra insumo',
  pago_obligacion:  'Pago',
  retiro_dueno:     'Retiro tuyo',
  aportacion_dueno: 'Metiste dinero',
  transferencia:    'Transferencia',
  ajuste_corte:     'Ajuste corte',
  ajuste_didi:      'Ajuste Didi',
  saldo_inicial:    'Saldo inicial',
};

export function vibrar() {
  if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(50);
}

// Mensaje legible de un error de Supabase/Postgres (RAISE EXCEPTION llega en .message)
export function msgError(err) {
  if (err?.code === '23505') return 'Ya existe uno con ese nombre.';
  return err?.message || String(err);
}
