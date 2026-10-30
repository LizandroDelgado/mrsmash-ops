// Insights automáticos por reglas (sin IA). Entran los agregados que ya calculó Postgres
// (RPC dashboard, dinero_comprometido, cashflow_proyectado) y salen máximo 5 tarjetas,
// ordenadas por gravedad y luego por impacto estimado en pesos.
import { formatMXN } from '@/lib/calculos';
import { precioSugerido } from '@/lib/precios';

const DIA = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const n = (x) => Number(x) || 0;
const pct = (x) => `${(n(x) * 100).toFixed(1)}%`;
const promedio = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

// Margen promedio por burger en un canal (simple entre burgers con precio en ese canal)
function margenBurger(margenes, canal) {
  return promedio(margenes.filter((m) => m.burger && m.canal === canal).map((m) => n(m.margen)));
}

export function generarInsights(dash, comp, extras = {}) {
  if (!dash) return [];
  const a = dash.actual || {};
  const dias = Math.max(1, (new Date(a.hasta) - new Date(a.desde)) / 864e5 + 1);
  const venta = n(a.venta_neta);
  const out = [];
  const add = (i) => out.push({ nivel: 'amarillo', ...i, impacto: Math.max(0, Math.round(n(i.impacto))) });

  // 6. Lo que vence en 7 días no alcanza con el efectivo
  if (comp && !comp.sin_saldos && n(comp.vence_7_dias) > n(comp.dinero_total)) {
    add({
      id: 'vence7', nivel: 'rojo', impacto: n(comp.vence_7_dias) - n(comp.dinero_total),
      titulo: 'No te alcanza para lo que vence esta semana',
      texto: `Vencen ${formatMXN(comp.vence_7_dias)} en 7 días y tienes ${formatMXN(comp.dinero_total)}.`,
      accion: 'Revisa Por pagar y negocia fechas o cobra a Didi antes.', href: '/gastos',
    });
  }

  // 1. Food cost arriba de la meta o subiendo
  const meta = n(a.meta_food_cost) || 0.32;
  const sem = (dash.fc_semanal || []).map((s) => s.fc).filter((x) => x != null).map(Number);
  const prom4 = promedio(sem.slice(-5, -1));
  if (a.food_cost != null && venta > 0 && (n(a.food_cost) > meta || (prom4 != null && n(a.food_cost) - prom4 > 0.02))) {
    const suben = (dash.inventario?.insumos_suben || []).slice(0, 3).map((s) => `${s.nombre} (+${(n(s.pct) * 100).toFixed(0)}%)`);
    add({
      id: 'foodcost', nivel: n(a.food_cost) > meta + 0.03 ? 'rojo' : 'amarillo',
      impacto: (n(a.food_cost) - Math.min(meta, prom4 ?? meta)) * venta,
      titulo: `Tu costo de comida está en ${pct(a.food_cost)} (meta ${pct(meta)})`,
      texto: suben.length ? `Subieron: ${suben.join(', ')}.` : prom4 != null ? `Tu promedio de 4 semanas era ${pct(prom4)}.` : 'Está arriba de tu meta.',
      accion: 'Revisa precios con tu proveedor o ajusta porciones y precios.', href: '/inventario/recetas',
    });
  }

  // 2. Didi vs canal directo
  const mDidi = margenBurger(dash.margenes || [], 'didi');
  const mWa = margenBurger(dash.margenes || [], 'whatsapp');
  const pedidosDidi = n(a.canales?.didi?.tickets);
  if (mDidi != null && mWa != null && mWa > mDidi && pedidosDidi > 0) {
    const porMes = (pedidosDidi / dias) * 30;
    const nPasar = Math.max(1, Math.round(porMes * 0.25));
    const gana = nPasar * (mWa - mDidi);
    add({
      id: 'didi', impacto: gana,
      titulo: `Cada burger en Didi te deja ${formatMXN(mWa - mDidi)} menos`,
      texto: `Si pasas ${nPasar} ${nPasar === 1 ? 'pedido' : 'pedidos'} al mes de Didi a WhatsApp ganas ≈ ${formatMXN(gana)} al mes.`,
      accion: 'Mete tu WhatsApp en la bolsa de Didi con un beneficio por pedir directo.',
    });
  }

  // 3. Promos de Didi más caras que la comisión
  if (n(a.promos_didi) > n(a.comision_didi) && n(a.promos_didi) > 0) {
    add({
      id: 'promos', impacto: n(a.promos_didi) - n(a.comision_didi),
      titulo: 'Las promos de Didi te cuestan más que la comisión',
      texto: `Promos ${formatMXN(a.promos_didi)} vs comisión ${formatMXN(a.comision_didi)} en el periodo.`,
      accion: 'Baja o apaga promos que no traen pedidos nuevos.',
    });
  }

  // 4. Ingeniería de menú (popularidad vs margen, cortes en el promedio)
  const prods = {};
  (dash.margenes || []).forEach((m) => {
    const p = (prods[m.nombre] ||= { nombre: m.nombre, unidades: 0, margenTotal: 0, margenes: [] });
    p.unidades += n(m.unidades);
    p.margenTotal += n(m.unidades) * n(m.margen);
    p.margenes.push(n(m.margen));
  });
  const lista = Object.values(prods).filter((p) => p.unidades > 0)
    .map((p) => ({ ...p, margen: p.margenTotal / p.unidades }));
  if (lista.length >= 3) {
    const corteU = promedio(lista.map((p) => p.unidades));
    const corteM = promedio(lista.map((p) => p.margen));
    const clase = (p) => (p.unidades >= corteU ? (p.margen >= corteM ? 'estrella' : 'caballo') : (p.margen >= corteM ? 'enigma' : 'perro'));
    const caballos = lista.filter((p) => clase(p) === 'caballo');
    const perros = lista.filter((p) => clase(p) === 'perro');
    const enigmas = lista.filter((p) => clase(p) === 'enigma');
    const estrellas = lista.filter((p) => clase(p) === 'estrella');
    const impacto = caballos.reduce((s, p) => s + p.unidades * (corteM - p.margen), 0) * (30 / dias);
    const partes = [];
    if (estrellas.length) partes.push(`⭐ ${estrellas.map((p) => p.nombre).join(', ')}`);
    if (caballos.length) partes.push(`🐴 se venden mucho pero dejan poco: ${caballos.map((p) => p.nombre).join(', ')}`);
    if (enigmas.length) partes.push(`❓ dejan bien pero se venden poco: ${enigmas.map((p) => p.nombre).join(', ')}`);
    if (perros.length) partes.push(`🐶 poco y poco: ${perros.map((p) => p.nombre).join(', ')}`);
    add({
      id: 'menu', nivel: 'info', impacto,
      titulo: 'Tu menú por popularidad y margen',
      texto: partes.join(' · '),
      accion: caballos.length ? `Sube un poco el precio o baja el costo de ${caballos[0].nombre}.`
        : enigmas.length ? `Promueve ${enigmas[0].nombre}.` : 'Mantén tus estrellas al frente del menú.',
      href: '/inventario/recetas',
    });
  }

  // 5. Día más débil vs más fuerte (martes a domingo)
  const dow = (dash.ventas_dow || []).filter((d) => d.dow !== 1 && n(d.promedio) > 0);
  if (dow.length >= 3) {
    const min = dow.reduce((x, y) => (n(y.promedio) < n(x.promedio) ? y : x));
    const max = dow.reduce((x, y) => (n(y.promedio) > n(x.promedio) ? y : x));
    const horas = (dash.heatmap || []).filter((h) => h.dow === min.dow);
    add({
      id: 'valle', nivel: 'info', impacto: (n(max.promedio) - n(min.promedio)) * 0.2 * 4,
      titulo: `El ${DIA[min.dow]} es tu día más flojo`,
      texto: `Vendes ${formatMXN(min.promedio)} un ${DIA[min.dow]} vs ${formatMXN(max.promedio)} un ${DIA[max.dow]}.`,
      accion: `Prueba una promo sólo los ${DIA[min.dow]}${horas.length ? ' en la primera hora' : ''} (ej. 2x1 en papas).`,
    });
  }

  // 7. Merma > 3% de la venta
  if (n(a.merma_pct) > 0.03) {
    const top = (dash.inventario?.merma_top || []).map((m) => `${m.nombre} ${formatMXN(m.valor)}`).join(', ');
    add({
      id: 'merma', nivel: 'rojo', impacto: n(a.merma) - 0.03 * venta,
      titulo: `Se te está yendo ${pct(a.merma_pct)} de la venta en merma`,
      texto: top ? `Lo que más se pierde: ${top}.` : `Merma de ${formatMXN(a.merma)}.`,
      accion: 'Revisa porciones, rotación (lo primero que entra, primero sale) y temperaturas.', href: '/inventario',
    });
  }

  // 8. Faltantes de caja en la semana
  const falt = n(dash.efectivo?.faltantes_7_dias);
  if (falt > 100) {
    add({
      id: 'caja', nivel: 'rojo', impacto: falt,
      titulo: `Te faltan ${formatMXN(falt)} en la caja esta semana`,
      texto: 'Suma de faltantes en tus cortes de los últimos 7 días.',
      accion: 'Haz corte diario y revisa quién maneja el efectivo.', href: '/caja',
    });
  }

  // 9. Debajo del punto de equilibrio a mitad de mes
  const mes = dash.mes || {};
  const mcb = n(mes.margen_contribucion_burger);
  if (n(mes.dias_transcurridos) >= n(mes.dias_mes) / 2 && mcb > 0 && n(mes.opex_mes) > 0) {
    const necesarias = Math.ceil(n(mes.opex_mes) / mcb);
    const esperadas = (necesarias * n(mes.dias_transcurridos)) / n(mes.dias_mes);
    if (n(mes.burgers) < esperadas) {
      const faltan = necesarias - n(mes.burgers);
      const porDia = Math.ceil(faltan / Math.max(1, n(mes.dias_abiertos_restantes)));
      add({
        id: 'equilibrio', nivel: 'rojo', impacto: faltan * mcb,
        titulo: 'Vas debajo de tu punto de equilibrio del mes',
        texto: `Llevas ${n(mes.burgers)} de ${necesarias} burgers para cubrir tus gastos.`,
        accion: `Necesitas ${porDia} burgers más por día lo que queda del mes.`,
      });
    }
  }

  // 10. Insumos por acabarse
  const cob = dash.inventario?.cobertura_baja || [];
  if (cob.length) {
    add({
      id: 'cobertura', nivel: 'rojo', impacto: venta / dias,
      titulo: `Se te acaba${cob.length > 1 ? 'n' : ''} ${cob.map((c) => c.nombre).join(', ')}`,
      texto: `Te alcanza para menos de 2 días (${cob.map((c) => `${c.nombre}: ${n(c.dias)} d`).join(', ')}).`,
      accion: 'Pide hoy: revisa la lista de compras.', href: '/inventario',
    });
  }

  // 11. Subió el costo de un insumo: cuánto bajó el margen y precio sugerido
  (extras.alertasCostos || []).slice(0, 2).forEach((al) => {
    const vendidas = n((dash.productos || []).find((p) => p.nombre === al.producto)?.unidades);
    const sug = extras.cfg ? precioSugerido(al.costo_producto, 'whatsapp', extras.cfg) : null;
    const fecha = new Date(al.desde + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
    add({
      id: `costo-${al.insumo}`, nivel: 'amarillo', impacto: n(al.delta_margen) * (vendidas ? (vendidas / dias) * 30 : 1),
      titulo: `El costo de ${al.insumo} subió ${(n(al.pct) * 100).toFixed(0)}% desde el ${fecha}`,
      texto: `Tu margen en ${al.producto} bajó ${formatMXN(al.delta_margen)} por pieza.`,
      accion: sug && sug > n(al.precio_whatsapp) ? `Precio sugerido en WhatsApp: ${formatMXN(sug)} (hoy ${formatMXN(al.precio_whatsapp)}).` : 'Revisa tus precios en Precios y costos.',
      href: '/configuracion/precios-costos',
    });
  });

  const orden = { rojo: 0, amarillo: 1, info: 2 };
  return out.sort((x, y) => orden[x.nivel] - orden[y.nivel] || y.impacto - x.impacto).slice(0, 5);
}
