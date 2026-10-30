// Utilidades de inventario: unidades amigables, lista de compras y texto para WhatsApp.
// En la base todo va en unidad_base (g, ml, pza); en pantalla se muestra kg / L cuando conviene.

export const CATEGORIAS_INSUMO = [
  { key: 'carne',   label: 'Carne' },
  { key: 'pan',     label: 'Pan' },
  { key: 'lacteos', label: 'Lácteos' },
  { key: 'verdura', label: 'Verdura' },
  { key: 'salsas',  label: 'Salsas' },
  { key: 'empaque', label: 'Empaque' },
  { key: 'bebidas', label: 'Bebidas' },
  { key: 'otro',    label: 'Otro' },
];
export const NOMBRE_CATEGORIA = Object.fromEntries(CATEGORIAS_INSUMO.map((c) => [c.key, c.label]));

// Unidad "grande" en la que se captura stock, conteos y costos: kg, L o pieza.
export const UNIDAD_GRANDE = {
  g:   { label: 'kg',  factor: 1000 },
  ml:  { label: 'L',   factor: 1000 },
  pza: { label: 'pza', factor: 1 },
};

// Chips para elegir unidad al dar de alta un insumo (se muestra la unidad de captura)
export const UNIDADES_ALTA = [
  { key: 'g',   label: 'kg / g' },
  { key: 'ml',  label: 'L / ml' },
  { key: 'pza', label: 'Pieza' },
];

const fmt = (n, dec) => Number(n).toLocaleString('es-MX', { maximumFractionDigits: dec });

// 1500 g → "1.5 kg" · 250 g → "250 g" · 12 pza → "12 pza"
export function fmtCantidad(q, unidad) {
  const n = Number(q) || 0;
  if (unidad !== 'pza' && Math.abs(n) >= 1000) return `${fmt(n / 1000, 2)} ${UNIDAD_GRANDE[unidad].label}`;
  return `${fmt(n, unidad === 'pza' ? 1 : 0)} ${unidad}`;
}

// Convierte entre unidad base y unidad de captura (kg/L/pza)
export const aGrande = (q, unidad) => (Number(q) || 0) / UNIDAD_GRANDE[unidad].factor;
export const deGrande = (q, unidad) => (Number(q) || 0) * UNIDAD_GRANDE[unidad].factor;

// Costo promedio por unidad de captura: $/kg, $/L o $/pza
export const costoGrande = (cp, unidad) => (Number(cp) || 0) * UNIDAD_GRANDE[unidad].factor;

// La lista de compras se calcula en Postgres (RPC lista_compras): misma regla para
// /inventario y para el dinero comprometido del dashboard.

// Texto para mandar por WhatsApp, agrupado por proveedor (sin costos: es para el proveedor)
export function textoListaCompras(lista, proveedores, fechaLabel) {
  const nombreProv = Object.fromEntries((proveedores || []).map((p) => [p.id, p.nombre]));
  const grupos = {};
  lista.forEach((s) => {
    const k = nombreProv[s.proveedor_id] || 'Sin proveedor';
    (grupos[k] = grupos[k] || []).push(s);
  });
  const partes = [`*Pedido MR. SMASH* · ${fechaLabel}`];
  Object.entries(grupos).forEach(([prov, items]) => {
    partes.push('');
    if (Object.keys(grupos).length > 1 || prov !== 'Sin proveedor') partes.push(`*${prov}*`);
    items.forEach((s) => partes.push(`• ${s.nombre}: ${fmtCantidad(s.sugerido, s.unidad_base)}`));
  });
  return partes.join('\n');
}

export async function copiarTexto(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    // Fallback para navegadores sin permiso de portapapeles
    const ta = document.createElement('textarea');
    ta.value = texto;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  }
}
