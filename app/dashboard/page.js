'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft, ChevronRight, TrendingUp, TrendingDown, Minus,
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import BottomNav from '@/components/BottomNav';
import { supabase } from '@/lib/supabase/client';
import { formatMXN } from '@/lib/calculos';
import {
  monthKey, monthLabel, buildMonthList, aggregateByMonth, calcularVariacion,
  rankingProductosDelMes, heatmapHoras, barrasDiaSemana, calcularRecords, vacioMes,
  buildCategoriaMap,
} from '@/lib/dashboard';

const NEGOCIO_ID = '34797ee1-37fa-4736-ad56-35578a126b08';
const MESES_CORTO = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function shortLabel(key) {
  const [anio, mes] = key.split('-').map(Number);
  return `${MESES_CORTO[mes - 1]} ${String(anio).slice(2)}`;
}

function Variacion({ valor }) {
  if (valor === null || valor === undefined || !isFinite(valor)) {
    return <span className="text-xs" style={{ color: '#555' }}>— sin comparación</span>;
  }
  const subiendo = valor > 0;
  const plano = Math.round(valor * 10) / 10 === 0;
  const color = plano ? '#888' : subiendo ? '#22c55e' : '#ef4444';
  const Icon = plano ? Minus : subiendo ? TrendingUp : TrendingDown;
  return (
    <span className="flex items-center gap-1 text-xs font-bold" style={{ color }}>
      <Icon size={12} strokeWidth={2.5} />
      {Math.abs(valor).toFixed(0)}%
    </span>
  );
}

function KpiCard({ label, value, variacion }) {
  return (
    <div className="rounded-2xl p-3 flex flex-col justify-between"
      style={{ background: '#141414', border: '1px solid #2a2a2a', minHeight: 56 }}>
      <p className="text-xs font-bold tracking-wide mb-1" style={{ color: '#888' }}>{label}</p>
      <p className="text-xl font-bold text-white mb-1">{value}</p>
      <Variacion valor={variacion} />
    </div>
  );
}

function SeccionError({ mensaje }) {
  return (
    <div className="rounded-2xl p-4 text-center" style={{ background: '#141414', border: '1px solid #2a2a2a' }}>
      <p className="text-sm" style={{ color: '#ef4444' }}>⚠ {mensaje}</p>
    </div>
  );
}

export default function DashboardPage() {
  const [pedidos, setPedidos] = useState(null);
  const [pedidosError, setPedidosError] = useState(null);
  const [importsDidi, setImportsDidi] = useState(null);
  const [didiError, setDidiError] = useState(null);
  const [insumos, setInsumos] = useState(null);
  const [insumosError, setInsumosError] = useState(null);
  const [categoriaMap, setCategoriaMap] = useState({});
  const [cargando, setCargando] = useState(true);
  const [selectedKey, setSelectedKey] = useState(null);

  useEffect(() => {
    let activo = true;
    (async () => {
      // Productos: intentar con categoria; si la columna no existe en la DB, sin ella
      // (mismo criterio defensivo que /finanzas — evita que un error de schema
      // tumbe el join anidado de pedido_items más abajo)
      let { data: productosData, error: prodErr } = await supabase
        .from('productos').select('id, nombre, categoria').eq('negocio_id', NEGOCIO_ID);
      if (prodErr) {
        ({ data: productosData } = await supabase
          .from('productos').select('id, nombre').eq('negocio_id', NEGOCIO_ID));
      }
      if (activo) setCategoriaMap(buildCategoriaMap(productosData));

      const [pedidosRes, didiRes, insumosRes] = await Promise.allSettled([
        supabase.from('pedidos')
          .select('total, canal, fecha, hora, pedido_items(producto_id, cantidad, precio, costo, productos(nombre))')
          .eq('negocio_id', NEGOCIO_ID)
          .eq('estado', 'entregado'),
        supabase.from('importaciones_didi')
          .select('venta_bruta, comision_didi, costo_promos, fecha')
          .eq('negocio_id', NEGOCIO_ID),
        supabase.from('compras_insumos')
          .select('monto, fecha')
          .eq('negocio_id', NEGOCIO_ID),
      ]);
      if (!activo) return;

      if (pedidosRes.status === 'fulfilled' && !pedidosRes.value.error) {
        setPedidos(pedidosRes.value.data || []);
      } else {
        setPedidos([]);
        setPedidosError(pedidosRes.value?.error?.message || pedidosRes.reason?.message || 'Error al cargar pedidos');
      }

      if (didiRes.status === 'fulfilled' && !didiRes.value.error) {
        setImportsDidi(didiRes.value.data || []);
      } else {
        setImportsDidi([]);
        setDidiError(didiRes.value?.error?.message || didiRes.reason?.message || 'Error al cargar importaciones Didi');
      }

      if (insumosRes.status === 'fulfilled' && !insumosRes.value.error) {
        setInsumos(insumosRes.value.data || []);
      } else {
        setInsumos([]);
        setInsumosError(insumosRes.value?.error?.message || insumosRes.reason?.message || 'Error al cargar insumos');
      }

      setCargando(false);
    })();
    return () => { activo = false; };
  }, []);

  const mesesMap = useMemo(
    () => aggregateByMonth(pedidos, importsDidi, insumos, categoriaMap),
    [pedidos, importsDidi, insumos, categoriaMap]
  );

  const monthList = useMemo(() => {
    const hoyKey = monthKey(new Date().toISOString().split('T')[0]);
    const keysConDatos = Object.keys(mesesMap).sort();
    const minKey = keysConDatos[0] || hoyKey;
    const maxKey = hoyKey > (keysConDatos[keysConDatos.length - 1] || hoyKey)
      ? hoyKey
      : keysConDatos[keysConDatos.length - 1];
    return buildMonthList(minKey, maxKey);
  }, [mesesMap]);

  useEffect(() => {
    if (!selectedKey && monthList.length) {
      const conDatos = monthList.filter((k) => mesesMap[k]?.tieneDatos);
      setSelectedKey(conDatos.length ? conDatos[conDatos.length - 1] : monthList[monthList.length - 1]);
    }
  }, [monthList, mesesMap, selectedKey]);

  const idx = monthList.indexOf(selectedKey);
  const mesActual = (selectedKey && mesesMap[selectedKey]) || vacioMes(selectedKey || '');
  const mesAnteriorKey = idx > 0 ? monthList[idx - 1] : null;
  const mesAnterior = mesAnteriorKey ? mesesMap[mesAnteriorKey] : null;

  const pedidosDelMes = useMemo(
    () => (pedidos || []).filter((p) => monthKey(p.fecha) === selectedKey),
    [pedidos, selectedKey]
  );

  const ranking = useMemo(() => rankingProductosDelMes(pedidosDelMes), [pedidosDelMes]);
  const horas = useMemo(() => heatmapHoras(pedidosDelMes), [pedidosDelMes]);
  const dias = useMemo(() => barrasDiaSemana(pedidosDelMes), [pedidosDelMes]);

  const mesesOrdenados = useMemo(
    () => monthList.map((k) => mesesMap[k] || vacioMes(k)),
    [monthList, mesesMap]
  );
  const records = useMemo(() => calcularRecords(mesesOrdenados), [mesesOrdenados]);

  const chartData = useMemo(
    () => mesesOrdenados.map((m) => ({
      key: m.key,
      label: shortLabel(m.key),
      venta: Math.round(m.ventaBruta),
      ganancia: Math.round(m.gananciaReal),
    })),
    [mesesOrdenados]
  );

  const totalPedidosCanal = mesActual.whatsapp.pedidos + mesActual.manual.pedidos + mesActual.didi.pedidos;
  const totalGananciaCanal = mesActual.whatsapp.venta + mesActual.manual.venta + mesActual.didi.ganancia;
  const comisionDidiPct = mesActual.ventaBruta ? (mesActual.comisionDidi / mesActual.ventaBruta) * 100 : 0;
  const maxHora = Math.max(1, ...horas.map((h) => h.pedidos));
  const maxDia = Math.max(1, ...dias.map((d) => d.pedidos));

  return (
    <div className="flex flex-col min-h-screen" style={{ background: '#0a0a0a' }}>
      <header className="sticky top-0 z-40 px-4 py-3"
        style={{ background: '#0a0a0a', borderBottom: '1px solid #1e1e1e' }}>
        <img src="/logo.png" alt="MR. SMASH" style={{ height: '36px', width: 'auto' }} />
      </header>

      <main className="flex-1 px-4 pt-4 pb-32 space-y-4">

        {/* Selector de mes */}
        <div className="flex items-center justify-between px-3 py-2 rounded-xl"
          style={{ background: '#141414', border: '1px solid #2a2a2a' }}>
          <button onClick={() => idx > 0 && setSelectedKey(monthList[idx - 1])}
            disabled={idx <= 0} className="p-2 rounded-lg"
            style={{ background: '#1e1e1e', opacity: idx <= 0 ? 0.3 : 1 }}>
            <ChevronLeft size={18} style={{ color: '#aaa' }} />
          </button>
          <p className="text-sm font-bold text-white">{monthLabel(selectedKey)}</p>
          <button onClick={() => idx < monthList.length - 1 && setSelectedKey(monthList[idx + 1])}
            disabled={idx >= monthList.length - 1} className="p-2 rounded-lg"
            style={{ background: '#1e1e1e', opacity: idx >= monthList.length - 1 ? 0.3 : 1 }}>
            <ChevronRight size={18} style={{ color: '#aaa' }} />
          </button>
        </div>

        {cargando ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 rounded-full border-2 animate-spin"
              style={{ borderColor: '#FF4D00', borderTopColor: 'transparent' }} />
          </div>
        ) : (
          <>
            {!mesActual.tieneDatos ? (
              <div className="rounded-2xl p-8 text-center" style={{ background: '#141414', border: '1px solid #2a2a2a' }}>
                <p className="text-3xl mb-2">📭</p>
                <p className="font-bold text-white">Sin datos este mes</p>
              </div>
            ) : (
              <>
                {/* KPIs */}
                {pedidosError && <SeccionError mensaje={pedidosError} />}
                <div className="grid grid-cols-2 gap-2">
                  <KpiCard label="VENTA BRUTA" value={formatMXN(mesActual.ventaBruta)}
                    variacion={mesAnterior ? calcularVariacion(mesActual.ventaBruta, mesAnterior.ventaBruta) : null} />
                  <KpiCard label="GANANCIA REAL" value={formatMXN(mesActual.gananciaReal)}
                    variacion={mesAnterior ? calcularVariacion(mesActual.gananciaReal, mesAnterior.gananciaReal) : null} />
                  <KpiCard label="TICKET PROMEDIO" value={formatMXN(mesActual.ticketPromedio)}
                    variacion={mesAnterior ? calcularVariacion(mesActual.ticketPromedio, mesAnterior.ticketPromedio) : null} />
                  <KpiCard label="PEDIDOS" value={mesActual.pedidosCount}
                    variacion={mesAnterior ? calcularVariacion(mesActual.pedidosCount, mesAnterior.pedidosCount) : null} />
                  <KpiCard label="BURGERS VENDIDAS" value={mesActual.burgers}
                    variacion={mesAnterior ? calcularVariacion(mesActual.burgers, mesAnterior.burgers) : null} />
                  <KpiCard label="MARGEN NETO" value={`${mesActual.margenNeto.toFixed(0)}%`}
                    variacion={mesAnterior ? calcularVariacion(mesActual.margenNeto, mesAnterior.margenNeto) : null} />
                </div>
              </>
            )}

            {/* Tendencia histórica */}
            <div className="rounded-2xl p-3" style={{ background: '#141414', border: '1px solid #2a2a2a' }}>
              <p className="text-xs font-bold tracking-wider mb-2" style={{ color: '#888' }}>TENDENCIA MENSUAL</p>
              {chartData.length ? (
                <div style={{ width: '100%', height: 220 }}>
                  <ResponsiveContainer>
                    <LineChart data={chartData}
                      onClick={(s) => { const k = s?.activePayload?.[0]?.payload?.key; if (k) setSelectedKey(k); }}>
                      <CartesianGrid stroke="#1e1e1e" vertical={false} />
                      <XAxis dataKey="label" stroke="#555" tick={{ fontSize: 10, fill: '#888' }} />
                      <YAxis stroke="#555" tick={{ fontSize: 10, fill: '#888' }} width={40}
                        tickFormatter={(v) => v >= 1000 ? `${Math.round(v / 1000)}k` : v} />
                      <Tooltip
                        contentStyle={{ background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 8 }}
                        labelStyle={{ color: '#fff' }}
                        formatter={(v) => formatMXN(v)} />
                      <Line type="monotone" dataKey="venta" name="Venta bruta" stroke="#FF4D00" strokeWidth={2}
                        dot={{ r: 3, fill: '#FF4D00' }} activeDot={{ r: 5, cursor: 'pointer' }} />
                      <Line type="monotone" dataKey="ganancia" name="Ganancia real" stroke="#22c55e" strokeWidth={2}
                        dot={{ r: 3, fill: '#22c55e' }} activeDot={{ r: 5, cursor: 'pointer' }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-sm py-6 text-center" style={{ color: '#555' }}>Sin historial todavía.</p>
              )}
              <div className="flex gap-4 justify-center mt-1">
                <span className="flex items-center gap-1.5 text-xs" style={{ color: '#aaa' }}>
                  <span style={{ width: 10, height: 10, borderRadius: 5, background: '#FF4D00', display: 'inline-block' }} /> Venta bruta
                </span>
                <span className="flex items-center gap-1.5 text-xs" style={{ color: '#aaa' }}>
                  <span style={{ width: 10, height: 10, borderRadius: 5, background: '#22c55e', display: 'inline-block' }} /> Ganancia real
                </span>
              </div>
            </div>

            {mesActual.tieneDatos && (
              <>
                {/* Mix de canal */}
                {didiError && <SeccionError mensaje={didiError} />}
                <div className="rounded-2xl p-4" style={{ background: '#141414', border: '1px solid #2a2a2a' }}>
                  <p className="text-xs font-bold tracking-wider mb-3" style={{ color: '#888' }}>MIX DE CANAL</p>

                  {[
                    { label: 'WhatsApp', pedidos: mesActual.whatsapp.pedidos, ganancia: mesActual.whatsapp.venta, color: '#25D366' },
                    { label: 'Manual',   pedidos: mesActual.manual.pedidos,   ganancia: mesActual.manual.venta,   color: '#888' },
                    { label: 'Didi',     pedidos: mesActual.didi.pedidos,     ganancia: mesActual.didi.ganancia,  color: '#FF4D00' },
                  ].map(({ label, pedidos: n, ganancia, color }) => {
                    const pctPedidos = totalPedidosCanal ? (n / totalPedidosCanal) * 100 : 0;
                    const pctGanancia = totalGananciaCanal ? (ganancia / totalGananciaCanal) * 100 : 0;
                    return (
                      <div key={label} className="mb-3 last:mb-0">
                        <div className="flex justify-between text-xs mb-1">
                          <span style={{ color: '#ccc', fontWeight: 'bold' }}>{label}</span>
                          <span style={{ color: '#888' }}>
                            {n} pedidos ({pctPedidos.toFixed(0)}%) · {pctGanancia.toFixed(0)}% ganancia
                          </span>
                        </div>
                        <div className="h-2 rounded-full overflow-hidden" style={{ background: '#1e1e1e' }}>
                          <div className="h-full rounded-full" style={{ width: `${pctPedidos}%`, background: color }} />
                        </div>
                      </div>
                    );
                  })}

                  <div className="mt-3 pt-3 flex justify-between items-center" style={{ borderTop: '1px solid #1e1e1e' }}>
                    <span className="text-xs" style={{ color: '#888' }}>Comisión Didi pagada</span>
                    <span className="text-sm font-bold" style={{ color: '#FF4D00' }}>
                      {formatMXN(mesActual.comisionDidi)} ({comisionDidiPct.toFixed(1)}% de venta bruta)
                    </span>
                  </div>
                </div>

                {/* Ranking de productos */}
                <div className="rounded-2xl overflow-hidden" style={{ background: '#141414', border: '1px solid #2a2a2a' }}>
                  <div className="px-4 py-3" style={{ borderBottom: '1px solid #1e1e1e' }}>
                    <p className="text-xs font-bold tracking-wider" style={{ color: '#888' }}>RANKING DE PRODUCTOS</p>
                  </div>
                  {ranking.length ? ranking.map((p) => (
                    <div key={p.nombre} className="flex items-center justify-between px-4 py-3"
                      style={{ borderBottom: '1px solid #1e1e1e' }}>
                      <div>
                        <p className="text-sm text-white">{p.nombre}</p>
                        <p className="text-xs" style={{ color: '#666' }}>{p.cantidad} uds</p>
                      </div>
                      <span className="font-bold" style={{ color: '#22c55e' }}>{formatMXN(p.ganancia)}</span>
                    </div>
                  )) : (
                    <p className="px-4 py-6 text-sm text-center" style={{ color: '#555' }}>
                      Sin detalle de productos (solo pedidos de Didi este mes, sin desglose por producto).
                    </p>
                  )}
                </div>

                {/* Operación */}
                <div className="rounded-2xl p-4" style={{ background: '#141414', border: '1px solid #2a2a2a' }}>
                  <p className="text-xs font-bold tracking-wider mb-3" style={{ color: '#888' }}>PEDIDOS POR HORA</p>
                  <div className="flex gap-px">
                    {horas.map((h) => (
                      <div key={h.hora} className="flex-1 rounded-sm" title={`${h.hora}:00 — ${h.pedidos} pedidos`}
                        style={{
                          height: 28,
                          background: h.pedidos ? `rgba(255,77,0,${0.15 + 0.85 * (h.pedidos / maxHora)})` : '#1a1a1a',
                        }} />
                    ))}
                  </div>
                  <div className="flex justify-between text-xs mt-1" style={{ color: '#555' }}>
                    <span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span>
                  </div>
                </div>

                <div className="rounded-2xl p-4" style={{ background: '#141414', border: '1px solid #2a2a2a' }}>
                  <p className="text-xs font-bold tracking-wider mb-3" style={{ color: '#888' }}>PEDIDOS POR DÍA</p>
                  <div className="space-y-2">
                    {dias.map((d) => (
                      <div key={d.label} className="flex items-center gap-2">
                        <span className="text-xs w-8" style={{ color: '#888' }}>{d.label}</span>
                        <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ background: '#1e1e1e' }}>
                          <div className="h-full rounded-full" style={{ width: `${(d.pedidos / maxDia) * 100}%`, background: '#FF4D00' }} />
                        </div>
                        <span className="text-xs w-6 text-right" style={{ color: '#aaa' }}>{d.pedidos}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Récords históricos */}
            {insumosError && <SeccionError mensaje={insumosError} />}
            <div className="rounded-2xl p-4" style={{ background: 'linear-gradient(135deg, #141414 0%, #1a1a0a 100%)', border: '1px solid #2a2a0a' }}>
              <p className="text-xs font-bold tracking-wider mb-3" style={{ color: '#888' }}>RÉCORDS HISTÓRICOS</p>
              {records ? (
                <>
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <div>
                      <p className="text-xs" style={{ color: '#666' }}>Mejor mes en venta</p>
                      <p className="text-sm font-bold text-white">{records.mejorVenta.label}</p>
                      <p className="text-sm font-bold" style={{ color: '#FF4D00' }}>{formatMXN(records.mejorVenta.ventaBruta)}</p>
                    </div>
                    <div>
                      <p className="text-xs" style={{ color: '#666' }}>Mejor mes en ganancia</p>
                      <p className="text-sm font-bold text-white">{records.mejorGanancia.label}</p>
                      <p className="text-sm font-bold" style={{ color: '#22c55e' }}>{formatMXN(records.mejorGanancia.gananciaReal)}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-3" style={{ borderTop: '1px solid #2a2a2a' }}>
                    <div>
                      <p className="text-xs" style={{ color: '#666' }}>Venta bruta acumulada</p>
                      <p className="text-sm font-bold text-white">{formatMXN(records.totales.ventaBruta)}</p>
                    </div>
                    <div>
                      <p className="text-xs" style={{ color: '#666' }}>Ganancia real acumulada</p>
                      <p className="text-sm font-bold text-white">{formatMXN(records.totales.gananciaReal)}</p>
                    </div>
                    <div>
                      <p className="text-xs" style={{ color: '#666' }}>Pedidos totales</p>
                      <p className="text-sm font-bold text-white">{records.totales.pedidosCount}</p>
                    </div>
                    <div>
                      <p className="text-xs" style={{ color: '#666' }}>Burgers vendidas</p>
                      <p className="text-sm font-bold text-white">{records.totales.burgers}</p>
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-sm text-center py-2" style={{ color: '#555' }}>Sin historial todavía.</p>
              )}
            </div>
          </>
        )}
      </main>

      <BottomNav />
    </div>
  );
}
