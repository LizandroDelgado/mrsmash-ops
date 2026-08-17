import { calcularGananciaPorProducto, calcularMargenNeto } from './calculos';

// Fallback por nombre: igual criterio que /finanzas, duplicado aquí a propósito
// para no depender de ni tocar app/finanzas/page.js
const CATEGORIA_POR_NOMBRE = {
  'Smash Sencilla':      'burger',
  'Smash Sencilla Promo':'burger',
  'Bacon Smash':         'burger',
  'Doble Smash':         'burger',
  'Doble Bacon Smash':   'burger',
  'Malteada Vainilla':   'malteada',
  'Malteada Fresa':      'malteada',
  'Malteada Chocolate':  'malteada',
  'Papas a la francesa': 'papas',
  'Papas Smash':         'papas',
  'Refresco':            'bebida',
};

function getCat(nombre, categoriaDB) {
  return categoriaDB || CATEGORIA_POR_NOMBRE[nombre] || 'otro';
}

// productos: filas de `productos` (id, nombre, categoria?) — categoria puede venir null
// si la columna no existe todavía en la DB; ahí se usa el fallback por nombre.
export function buildCategoriaMap(productos) {
  const map = {};
  (productos || []).forEach((p) => { map[p.id] = getCat(p.nombre, p.categoria ?? null); });
  return map;
}

export const MESES_FULL = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio',
  'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

export function monthKey(fecha) {
  return fecha ? fecha.slice(0, 7) : null;
}

export function monthLabel(key) {
  if (!key) return '';
  const [anio, mes] = key.split('-').map(Number);
  return `${MESES_FULL[mes - 1]} ${anio}`;
}

export function buildMonthList(minKey, maxKey) {
  if (!minKey || !maxKey) return [];
  const meses = [];
  let [anio, mes] = minKey.split('-').map(Number);
  const [anioFin, mesFin] = maxKey.split('-').map(Number);
  while (anio < anioFin || (anio === anioFin && mes <= mesFin)) {
    meses.push(`${anio}-${String(mes).padStart(2, '0')}`);
    mes += 1;
    if (mes > 12) { mes = 1; anio += 1; }
  }
  return meses;
}

export function vacioMes(key) {
  return {
    key,
    label: monthLabel(key),
    ventaBruta: 0,
    gananciaReal: 0,
    pedidosCount: 0,
    burgers: 0,
    ticketPromedio: 0,
    margenNeto: 0,
    insumos: 0,
    comisionDidi: 0,
    costoPromosDidi: 0,
    whatsapp: { pedidos: 0, venta: 0 },
    manual:   { pedidos: 0, venta: 0 },
    didi:     { pedidos: 0, venta: 0, comision: 0, promos: 0, ganancia: 0 },
    tieneDatos: false,
  };
}

// pedidos: filas de `pedidos` (estado='entregado') con pedido_items(producto_id, cantidad, precio, costo, productos(nombre))
// importsDidi: filas de `importaciones_didi`
// insumos: filas de `compras_insumos`
// categoriaMap: { [producto_id]: categoria } — ver buildCategoriaMap()
export function aggregateByMonth(pedidos, importsDidi, insumos, categoriaMap = {}) {
  const meses = {};
  const get = (key) => {
    if (!meses[key]) meses[key] = vacioMes(key);
    return meses[key];
  };

  (pedidos || []).forEach((p) => {
    const key = monthKey(p.fecha);
    if (!key) return;
    const m = get(key);
    m.tieneDatos = true;
    m.pedidosCount += 1;
    m.ventaBruta += p.total || 0;
    if (p.canal === 'whatsapp') { m.whatsapp.pedidos += 1; m.whatsapp.venta += p.total || 0; }
    else if (p.canal === 'manual') { m.manual.pedidos += 1; m.manual.venta += p.total || 0; }
    else if (p.canal === 'didi') { m.didi.pedidos += 1; m.didi.venta += p.total || 0; m.didi.ganancia += p.total || 0; }

    (p.pedido_items || []).forEach((item) => {
      const cat = categoriaMap[item.producto_id] || getCat(item.productos?.nombre, null);
      if (cat === 'burger') m.burgers += item.cantidad || 0;
    });
  });

  (importsDidi || []).forEach((d) => {
    const key = monthKey(d.fecha);
    if (!key) return;
    const m = get(key);
    m.tieneDatos = true;
    m.pedidosCount += 1;
    m.ventaBruta += d.venta_bruta || 0;
    m.comisionDidi += d.comision_didi || 0;
    m.costoPromosDidi += d.costo_promos || 0;
    m.didi.pedidos += 1;
    m.didi.venta += d.venta_bruta || 0;
    m.didi.comision += d.comision_didi || 0;
    m.didi.promos += d.costo_promos || 0;
    m.didi.ganancia += (d.venta_bruta || 0) - (d.comision_didi || 0) - (d.costo_promos || 0);
  });

  (insumos || []).forEach((i) => {
    const key = monthKey(i.fecha);
    if (!key) return;
    get(key).insumos += i.monto || 0;
  });

  Object.values(meses).forEach((m) => {
    m.gananciaReal = m.ventaBruta - m.insumos - m.comisionDidi - m.costoPromosDidi;
    m.ticketPromedio = m.pedidosCount ? m.ventaBruta / m.pedidosCount : 0;
    m.margenNeto = calcularMargenNeto(m.gananciaReal, m.ventaBruta);
  });

  return meses;
}

export function calcularVariacion(actual, anterior) {
  if (anterior === null || anterior === undefined || anterior === 0) return null;
  return ((actual - anterior) / Math.abs(anterior)) * 100;
}

// pedidos: mismas filas que aggregateByMonth, ya filtradas al mes seleccionado
export function rankingProductosDelMes(pedidosDelMes) {
  const items = [];
  (pedidosDelMes || []).forEach((p) => {
    (p.pedido_items || []).forEach((item) => {
      items.push({
        producto_id: item.producto_id,
        cantidad: item.cantidad,
        precio: item.precio,
        costo: item.costo,
        productos: item.productos,
      });
    });
  });
  return calcularGananciaPorProducto(items);
}

export function heatmapHoras(pedidosDelMes) {
  const horas = Array.from({ length: 24 }, (_, h) => ({ hora: h, pedidos: 0 }));
  (pedidosDelMes || []).forEach((p) => {
    if (!p.hora) return;
    const h = parseInt(p.hora.slice(0, 2), 10);
    if (h >= 0 && h < 24) horas[h].pedidos += 1;
  });
  return horas;
}

export function barrasDiaSemana(pedidosDelMes) {
  const conteos = DIAS_SEMANA.map((label) => ({ label, pedidos: 0 }));
  (pedidosDelMes || []).forEach((p) => {
    if (!p.fecha) return;
    const dow = new Date(`${p.fecha}T12:00:00`).getDay(); // 0=domingo
    const idx = dow === 0 ? 6 : dow - 1; // Lun=0 ... Dom=6
    conteos[idx].pedidos += 1;
  });
  return conteos;
}

export function calcularRecords(mesesOrdenados) {
  if (!mesesOrdenados.length) return null;
  const conDatos = mesesOrdenados.filter((m) => m.tieneDatos);
  if (!conDatos.length) return null;

  const mejorVenta = conDatos.reduce((a, b) => (b.ventaBruta > a.ventaBruta ? b : a));
  const mejorGanancia = conDatos.reduce((a, b) => (b.gananciaReal > a.gananciaReal ? b : a));

  const totales = conDatos.reduce((acc, m) => ({
    ventaBruta: acc.ventaBruta + m.ventaBruta,
    gananciaReal: acc.gananciaReal + m.gananciaReal,
    pedidosCount: acc.pedidosCount + m.pedidosCount,
    burgers: acc.burgers + m.burgers,
  }), { ventaBruta: 0, gananciaReal: 0, pedidosCount: 0, burgers: 0 });

  return { mejorVenta, mejorGanancia, totales };
}
