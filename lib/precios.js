// Reglas de precios por canal. Una sola implementación para el panel de precios y los insights:
// la vista previa y lo que se guarda salen de estas mismas funciones.

import { CANAL_LABEL } from './canales';

export const CANALES_PRECIO = [
  { key: 'whatsapp', campo: 'precio_whatsapp', label: CANAL_LABEL.whatsapp },
  { key: 'didi',     campo: 'precio_didi',     label: CANAL_LABEL.didi },
  { key: 'salon',    campo: 'precio_salon',    label: CANAL_LABEL.salon },
];

export const CATEGORIAS_PRODUCTO = [
  { key: 'burger',   label: 'Burgers' },
  { key: 'papas',    label: 'Papas' },
  { key: 'malteada', label: 'Malteadas' },
  { key: 'bebida',   label: 'Bebidas' },
];

const n = (x) => Number(x) || 0;
const r2 = (x) => Math.round(x * 100) / 100;

// Redondea HACIA ARRIBA al siguiente entero que termina en 9: 131.2 → 139, 139 → 139, 140 → 149
export function terminacion9(x) {
  const r = Math.ceil(n(x) - 1e-9);
  return r + ((9 - (r % 10)) + 10) % 10;
}

// Comisión + promos de Didi (configuracion_negocio)
export const deduccionDidi = (cfg) => n(cfg?.pct_comision_didi) + n(cfg?.pct_promos_didi);

// Lo que realmente entra por cada venta en el canal
export function precioNeto(precio, canal, cfg) {
  if (precio == null || precio === '') return null;
  return canal === 'didi' ? r2(n(precio) * (1 - deduccionDidi(cfg))) : n(precio);
}

// Margen de contribución del canal: $ y % sobre lo que entra; semáforo contra las metas:
// verde = costo de comida dentro de meta_food_cost · ámbar = margen ≥ meta_margen_minimo_pct · rojo = abajo
export function margenCanal(precio, costo, canal, cfg) {
  const neto = precioNeto(precio, canal, cfg);
  if (neto == null || neto <= 0) return null;
  const margen = r2(neto - n(costo));
  const pct = margen / neto;
  const fc = n(costo) / neto;
  const semaforo = fc <= n(cfg?.meta_food_cost) ? 'verde' : pct >= n(cfg?.meta_margen_minimo_pct) ? 'ambar' : 'rojo';
  return { neto, margen, pct, fc, semaforo };
}

// Precio que da el margen meta con el costo actual, terminación 9. En Didi descuenta comisión + promos.
export function precioSugerido(costo, canal, cfg) {
  const m = n(cfg?.meta_margen_minimo_pct) || 0;
  if (!(n(costo) > 0) || m >= 1) return null;
  const netoObjetivo = n(costo) / (1 - m);
  const precio = canal === 'didi' ? netoObjetivo / (1 - deduccionDidi(cfg)) : netoObjetivo;
  return terminacion9(precio);
}

// Ajuste masivo: +X % con terminación 9
export const subirPrecio = (precio, pct) => (precio == null ? null : terminacion9(n(precio) * (1 + n(pct) / 100)));

// Costo por unidad base a partir de "como lo compra": $350 el kilo, $95 los 12 panes
export function costoBaseDesdeCompra(precio, cantidad, factor) {
  const q = n(cantidad) * n(factor);
  return q > 0 ? n(precio) / q : null;
}
