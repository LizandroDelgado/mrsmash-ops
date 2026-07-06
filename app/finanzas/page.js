'use client';
import { useEffect, useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import BottomNav from '@/components/BottomNav';
import { supabase } from '@/lib/supabase/client';
import { formatMXN } from '@/lib/calculos';

// Fallback por nombre: usado cuando la columna `categoria` aún no existe en la DB
const CATEGORIA_POR_NOMBRE = {
  'Smash Sencilla':     'burger',
  'Smash Sencilla Promo':'burger',
  'Bacon Smash':        'burger',
  'Doble Smash':        'burger',
  'Doble Bacon Smash':  'burger',
  'Malteada Vainilla':  'malteada',
  'Malteada Fresa':     'malteada',
  'Malteada Chocolate': 'malteada',
  'Papas a la francesa':'papas',
  'Papas Smash':        'papas',
  'Refresco':           'bebida',
};

const EMOJI_CAT     = { burger: '🍔', malteada: '🥤', papas: '🍟', bebida: '🥤' };
const CAT_ORDEN_IDX = { burger: 0, malteada: 1, papas: 2, bebida: 3 };

function getCat(nombre, categoriaDB) {
  return categoriaDB || CATEGORIA_POR_NOMBRE[nombre] || 'otro';
}

const MESES_CORTO = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const MESES_FULL  = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto',
                     'Septiembre','Octubre','Noviembre','Diciembre'];

function getSemanaRange(offset) {
  const hoy       = new Date();
  const diaSemana = hoy.getDay();
  const diff      = diaSemana === 0 ? -6 : 1 - diaSemana;
  const lunes     = new Date(hoy);
  lunes.setDate(hoy.getDate() + diff + offset * 7);
  lunes.setHours(0, 0, 0, 0);
  const domingo = new Date(lunes);
  domingo.setDate(lunes.getDate() + 6);
  return {
    inicio: lunes.toISOString().split('T')[0],
    fin:    domingo.toISOString().split('T')[0],
    label:  `${lunes.getDate()} ${MESES_CORTO[lunes.getMonth()]} – ${domingo.getDate()} ${MESES_CORTO[domingo.getMonth()]}`,
  };
}

function getMesRange(offset) {
  const hoy   = new Date();
  const fecha = new Date(hoy.getFullYear(), hoy.getMonth() + offset, 1);
  const fin   = new Date(fecha.getFullYear(), fecha.getMonth() + 1, 0);
  return {
    inicio: fecha.toISOString().split('T')[0],
    fin:    fin.toISOString().split('T')[0],
    label:  `${MESES_FULL[fecha.getMonth()]} ${fecha.getFullYear()}`,
  };
}

export default function FinanzasPage() {
  const [periodo,      setPeriodo]      = useState('semana');
  const [semanaOffset, setSemanaOffset] = useState(0);
  const [mesOffset,    setMesOffset]    = useState(0);
  const [datos,        setDatos]        = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [negocioId,    setNegocioId]    = useState(null);

  const getRango = useCallback(() => {
    const hoy = new Date().toISOString().split('T')[0];
    if (periodo === 'semana') return getSemanaRange(semanaOffset);
    if (periodo === 'mes')    return getMesRange(mesOffset);
    return { inicio: '2020-01-01', fin: hoy, label: 'Todo el historial' };
  }, [periodo, semanaOffset, mesOffset]);

  useEffect(() => {
    supabase.from('productos').select('negocio_id').limit(1).single()
      .then(({ data }) => { if (data?.negocio_id) setNegocioId(data.negocio_id); });
  }, []);

  useEffect(() => {
    if (negocioId) cargarDatos(negocioId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [negocioId, periodo, semanaOffset, mesOffset]);

  const cargarDatos = async (nid) => {
    setLoading(true);
    const { inicio, fin } = getRango();

    // ── Productos: intentar con categoria; si la columna no existe, sin ella ──
    // Esto evita que un error de schema rompa toda la pantalla
    let { data: productosData, error: prodErr } = await supabase
      .from('productos')
      .select('id, nombre, categoria')
      .eq('negocio_id', nid);
    if (prodErr) {
      ({ data: productosData } = await supabase
        .from('productos')
        .select('id, nombre')
        .eq('negocio_id', nid));
    }

    // Mapa nombre → categoria (DB primero; si null, fallback al mapa JS)
    const productCatMap = {};
    (productosData || []).forEach(p => {
      productCatMap[p.nombre] = getCat(p.nombre, p.categoria ?? null);
    });

    // ── Pedidos entregados con items
    // IMPORTANTE: no pedir `categoria` en el join anidado productos(nombre)
    // para evitar que un error de columna borre los resultados.
    const { data: pedidosEntregados } = await supabase
      .from('pedidos')
      .select('total, pedido_items(cantidad, productos(nombre))')
      .eq('negocio_id', nid)
      .eq('estado', 'entregado')
      .gte('fecha', inicio)
      .lte('fecha', fin);

    // ── Importaciones Didi
    const { data: importDidi } = await supabase
      .from('importaciones_didi')
      .select('venta_bruta, comision_didi, costo_promos')
      .eq('negocio_id', nid)
      .gte('fecha', inicio)
      .lte('fecha', fin);

    // ── Compras de insumos
    const { data: insumos } = await supabase
      .from('compras_insumos')
      .select('monto')
      .eq('negocio_id', nid)
      .gte('fecha', inicio)
      .lte('fecha', fin);

    // ── Totales financieros ──────────────────────────────────────────────────
    const ventasPedidos    = (pedidosEntregados || []).reduce((s, p) => s + (p.total || 0), 0);
    const ventasBrutasDidi = (importDidi || []).reduce((s, d) => s + (d.venta_bruta   || 0), 0);
    const comisionDidi     = (importDidi || []).reduce((s, d) => s + (d.comision_didi || 0), 0);
    const costoPromosDidi  = (importDidi || []).reduce((s, d) => s + (d.costo_promos  || 0), 0);
    const totalInsumos     = (insumos    || []).reduce((s, i) => s + (i.monto || 0), 0);

    const ventas_brutas = ventasPedidos + ventasBrutasDidi;
    const ganancia_real = ventas_brutas - totalInsumos - comisionDidi - costoPromosDidi;

    // Punto de equilibrio = todos los costos del periodo (en pesos)
    const punto_equilibrio = totalInsumos + comisionDidi + costoPromosDidi;

    // ── Cantidades por producto ──────────────────────────────────────────────
    const acum = {}; // { nombre: { cantidad, categoria } }
    (pedidosEntregados || []).forEach(p => {
      (p.pedido_items || []).forEach(item => {
        const nombre = item.productos?.nombre;
        if (!nombre) return;
        const cat = productCatMap[nombre] || getCat(nombre, null);
        if (!acum[nombre]) acum[nombre] = { cantidad: 0, categoria: cat };
        acum[nombre].cantidad += item.cantidad;
      });
    });

    // Ordenar: primero por categoría (orden definido), luego por cantidad desc
    const ventas_por_producto = Object.entries(acum)
      .map(([nombre, d]) => ({ nombre, ...d }))
      .sort((a, b) => {
        const catDiff = (CAT_ORDEN_IDX[a.categoria] ?? 99) - (CAT_ORDEN_IDX[b.categoria] ?? 99);
        return catDiff !== 0 ? catDiff : b.cantidad - a.cantidad;
      });

    const total_productos = ventas_por_producto.reduce((s, p) => s + p.cantidad, 0);

    setDatos({
      ventas_brutas,
      total_insumos:            totalInsumos,
      comision_didi:            comisionDidi,
      costo_promos_didi:        costoPromosDidi,
      ganancia_real,
      punto_equilibrio,
      ventas_por_producto,
      total_productos,
      tiene_importaciones_didi: (importDidi || []).length > 0,
    });
    setLoading(false);
  };

  const pctRetencion = datos?.ventas_brutas
    ? ((datos.ganancia_real / datos.ventas_brutas) * 100).toFixed(0)
    : 0;

  const rango = getRango();

  return (
    <div className="flex flex-col min-h-screen" style={{ background: '#0a0a0a' }}>
      <header className="sticky top-0 z-40 px-4 py-3"
        style={{ background: '#0a0a0a', borderBottom: '1px solid #1e1e1e' }}>
        <img src="/logo.png" alt="MR. SMASH" style={{ height: '36px', width: 'auto' }} />
      </header>

      <main className="flex-1 px-4 pt-4 pb-32 space-y-4">

        {/* ── Selector de periodo ── */}
        <div className="flex gap-2">
          {[
            { key: 'semana', label: 'Semana' },
            { key: 'mes',    label: 'Mes'    },
            { key: 'total',  label: 'Todo'   },
          ].map(({ key, label }) => (
            <button key={key} onClick={() => setPeriodo(key)}
              className="flex-1 py-2 rounded-xl font-bold text-sm"
              style={{
                background: periodo === key ? '#FF4D00' : '#141414',
                color:      periodo === key ? '#fff'    : '#888',
              }}>
              {label}
            </button>
          ))}
        </div>

        {/* ── Navegador de semana ── */}
        {periodo === 'semana' && (
          <div className="flex items-center justify-between px-3 py-2 rounded-xl"
            style={{ background: '#141414', border: '1px solid #2a2a2a' }}>
            <button onClick={() => setSemanaOffset((o) => o - 1)} className="p-2 rounded-lg"
              style={{ background: '#1e1e1e' }}>
              <ChevronLeft size={18} style={{ color: '#aaa' }} />
            </button>
            <div className="text-center">
              <p className="text-sm font-bold text-white">{rango.label}</p>
              {semanaOffset === 0
                ? <p className="text-xs" style={{ color: '#FF4D00' }}>Semana actual</p>
                : <p className="text-xs" style={{ color: '#888' }}>
                    {semanaOffset === -1 ? 'Semana pasada' : `Hace ${Math.abs(semanaOffset)} semanas`}
                  </p>
              }
            </div>
            <button onClick={() => setSemanaOffset((o) => Math.min(0, o + 1))}
              disabled={semanaOffset === 0} className="p-2 rounded-lg"
              style={{ background: '#1e1e1e', opacity: semanaOffset === 0 ? 0.3 : 1 }}>
              <ChevronRight size={18} style={{ color: '#aaa' }} />
            </button>
          </div>
        )}

        {/* ── Navegador de mes ── */}
        {periodo === 'mes' && (
          <div className="flex items-center justify-between px-3 py-2 rounded-xl"
            style={{ background: '#141414', border: '1px solid #2a2a2a' }}>
            <button onClick={() => setMesOffset((o) => o - 1)} className="p-2 rounded-lg"
              style={{ background: '#1e1e1e' }}>
              <ChevronLeft size={18} style={{ color: '#aaa' }} />
            </button>
            <div className="text-center">
              <p className="text-sm font-bold text-white">{rango.label}</p>
              {mesOffset === 0
                ? <p className="text-xs" style={{ color: '#FF4D00' }}>Mes actual</p>
                : <p className="text-xs" style={{ color: '#888' }}>
                    {mesOffset === -1 ? 'Mes pasado' : `Hace ${Math.abs(mesOffset)} meses`}
                  </p>
              }
            </div>
            <button onClick={() => setMesOffset((o) => Math.min(0, o + 1))}
              disabled={mesOffset === 0} className="p-2 rounded-lg"
              style={{ background: '#1e1e1e', opacity: mesOffset === 0 ? 0.3 : 1 }}>
              <ChevronRight size={18} style={{ color: '#aaa' }} />
            </button>
          </div>
        )}

        {periodo === 'total' && (
          <p className="text-xs text-center" style={{ color: '#666' }}>Mostrando todo el historial</p>
        )}

        {/* ── Contenido ── */}
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 rounded-full border-2 animate-spin"
              style={{ borderColor: '#FF4D00', borderTopColor: 'transparent' }} />
          </div>
        ) : datos ? (
          <>
            {/* Hero: Ganancia real */}
            <div className="rounded-2xl p-5 text-center"
              style={{
                background: 'linear-gradient(135deg, #141414 0%, #1a1a0a 100%)',
                border: '1px solid #2a2a0a',
              }}>
              <p className="text-xs font-bold tracking-widest mb-2" style={{ color: '#888' }}>
                GANANCIA REAL
              </p>
              <p className="text-5xl font-bold mb-1"
                style={{ color: datos.ganancia_real >= 0 ? '#22c55e' : '#ef4444' }}>
                {formatMXN(datos.ganancia_real)}
              </p>
              <p className="text-sm" style={{ color: '#666' }}>
                {pctRetencion}% de tus ventas brutas
              </p>
            </div>

            {/* Desglose financiero */}
            <div className="rounded-2xl overflow-hidden" style={{ background: '#141414' }}>
              {[
                { label: 'Ventas brutas',  value:  datos.ventas_brutas,     color: '#fff'    },
                { label: '− Insumos',       value: -datos.total_insumos,     color: '#ef4444' },
                { label: '− Comisión Didi', value: -datos.comision_didi,     color: '#f97316' },
                { label: '− Promos Didi',   value: -datos.costo_promos_didi, color: '#f97316' },
              ].map(({ label, value, color }, i, arr) => (
                <div key={label} className="flex items-center justify-between px-4 py-3"
                  style={{ borderBottom: i < arr.length - 1 ? '1px solid #1e1e1e' : 'none' }}>
                  <span style={{ color: '#aaa', fontSize: 14 }}>{label}</span>
                  <span style={{ color, fontWeight: 'bold' }}>{formatMXN(value)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between px-4 py-3"
                style={{ background: '#1e1e1e', borderTop: '2px solid #2a2a2a' }}>
                <span className="font-bold text-white">= Ganancia real</span>
                <span className="font-bold text-xl"
                  style={{ color: datos.ganancia_real >= 0 ? '#22c55e' : '#ef4444' }}>
                  {formatMXN(datos.ganancia_real)}
                </span>
              </div>
            </div>

            {/* Punto de equilibrio en pesos */}
            <div className="rounded-2xl p-4"
              style={{ background: '#141414', border: '1px solid #2a2a2a' }}>
              <p className="text-xs font-bold tracking-wider mb-3" style={{ color: '#888' }}>
                PUNTO DE EQUILIBRIO
              </p>

              {datos.punto_equilibrio > 0 ? (
                <>
                  <p className="text-sm mb-1" style={{ color: '#aaa' }}>
                    Para cubrir tus costos necesitas vender
                  </p>
                  <p className="text-3xl font-bold text-white mb-4">
                    {formatMXN(datos.punto_equilibrio)}
                  </p>

                  {/* Barra de progreso */}
                  <div className="h-3 rounded-full overflow-hidden mb-3"
                    style={{ background: '#2a2a2a' }}>
                    <div className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.min(100,
                          (datos.ventas_brutas / datos.punto_equilibrio) * 100
                        )}%`,
                        background: datos.ventas_brutas >= datos.punto_equilibrio
                          ? '#22c55e' : '#FF4D00',
                      }} />
                  </div>

                  {datos.ventas_brutas >= datos.punto_equilibrio ? (
                    <p className="text-sm font-bold" style={{ color: '#22c55e' }}>
                      ✓ Meta alcanzada — vendiste {formatMXN(datos.ventas_brutas)} de{' '}
                      {formatMXN(datos.punto_equilibrio)}
                    </p>
                  ) : (
                    <p className="text-sm" style={{ color: '#888' }}>
                      Faltan{' '}
                      <span style={{ color: '#FF4D00', fontWeight: 'bold' }}>
                        {formatMXN(datos.punto_equilibrio - datos.ventas_brutas)}
                      </span>{' '}
                      para cubrir tus costos
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm" style={{ color: '#666' }}>
                  Sin costos registrados este periodo.
                </p>
              )}
            </div>

            {/* Productos vendidos */}
            <div className="rounded-2xl overflow-hidden" style={{ background: '#141414' }}>
              <div className="px-4 py-3" style={{ borderBottom: '1px solid #1e1e1e' }}>
                <p className="text-xs font-bold tracking-wider" style={{ color: '#888' }}>
                  PRODUCTOS VENDIDOS
                </p>
              </div>

              {datos.ventas_por_producto.length > 0 ? (
                <>
                  {datos.ventas_por_producto.map((item) => (
                    <div key={item.nombre}
                      className="flex items-center justify-between px-4 py-3"
                      style={{ borderBottom: '1px solid #1e1e1e' }}>
                      <span style={{ color: '#ccc', fontSize: 14 }}>
                        {EMOJI_CAT[item.categoria] || '📦'} {item.nombre}
                      </span>
                      <span style={{ color: '#fff', fontWeight: 'bold' }}>
                        {item.cantidad} uds
                      </span>
                    </div>
                  ))}

                  <div className="flex items-center justify-between px-4 py-3"
                    style={{ background: '#1a1a1a', borderTop: '2px solid #2a2a2a' }}>
                    <span style={{ color: '#888', fontSize: 14 }}>Total</span>
                    <span style={{ color: '#fff', fontWeight: 'bold' }}>
                      {datos.total_productos} unidades vendidas
                    </span>
                  </div>

                  {datos.tiene_importaciones_didi && (
                    <p className="px-4 py-2 text-xs"
                      style={{ color: '#555', borderTop: '1px solid #1e1e1e' }}>
                      Detalle por producto no disponible para pedidos importados de Didi
                    </p>
                  )}
                </>
              ) : (
                <div className="px-4 py-8 text-center">
                  <p className="text-sm" style={{ color: '#555' }}>
                    Sin ventas detalladas en este periodo.
                  </p>
                  {datos.tiene_importaciones_didi && (
                    <p className="text-xs mt-2" style={{ color: '#444' }}>
                      Detalle por producto no disponible para pedidos importados de Didi
                    </p>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          <p style={{ color: '#666' }}>Sin datos para este periodo.</p>
        )}
      </main>

      <BottomNav />
    </div>
  );
}
