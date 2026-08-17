export function calcularPuntoEquilibrio(costos_totales, ganancia_promedio_por_burger) {
  if (!ganancia_promedio_por_burger || ganancia_promedio_por_burger <= 0) return 0;
  return Math.ceil(costos_totales / ganancia_promedio_por_burger);
}

export function calcularGananciaReal({ ventas_brutas, insumos, comision_didi, gastos_fijos = 0 }) {
  return ventas_brutas - insumos - Math.abs(comision_didi || 0) - gastos_fijos;
}

export function calcularGananciaPorProducto(pedidoItems) {
  const acum = {}; // { producto_id: { nombre, cantidad, ganancia } }
  (pedidoItems || []).forEach((item) => {
    const id = item.producto_id;
    if (!id) return;
    const nombre = item.productos?.nombre || 'Desconocido';
    if (!acum[id]) acum[id] = { nombre, cantidad: 0, ganancia: 0 };
    acum[id].cantidad  += item.cantidad || 0;
    acum[id].ganancia  += ((item.precio || 0) - (item.costo || 0)) * (item.cantidad || 0);
  });
  return Object.values(acum).sort((a, b) => b.ganancia - a.ganancia);
}

export function calcularMargenNeto(ganancia_real, ventas_brutas) {
  if (!ventas_brutas) return 0;
  return (ganancia_real / ventas_brutas) * 100;
}

export function formatMXN(amount) {
  if (amount === null || amount === undefined) return '$0';
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatHora(hora) {
  if (!hora) return '';
  return hora.substring(0, 5);
}

export function getFechaOperativa() {
  return new Date().toISOString().split('T')[0];
}

export function getInicioSemana() {
  const hoy = new Date();
  const dia = hoy.getDay(); // 0 domingo
  const diff = hoy.getDate() - dia + (dia === 0 ? -6 : 1);
  const lunes = new Date(hoy.setDate(diff));
  lunes.setHours(0, 0, 0, 0);
  return lunes.toISOString().split('T')[0];
}
