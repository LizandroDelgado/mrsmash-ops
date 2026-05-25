'use client';
import { useEffect, useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import BottomNav from '@/components/BottomNav';
import { supabase } from '@/lib/supabase/client';
import { formatMXN, calcularPuntoEquilibrio } from '@/lib/calculos';

const GANANCIA_PROMEDIO_BURGER = 58;

const MESES_CORTO = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const MESES_FULL = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

// Retorna { inicio, fin, label } para la semana con offset respecto a la actual
function getSemanaRange(offset) {
  const hoy = new Date();
  const diaSemana = hoy.getDay(); // 0=Dom
  const diff = diaSemana === 0 ? -6 : 1 - diaSemana;
  const lunes = new Date(hoy);
  lunes.setDate(hoy.getDate() + diff + offset * 7);
  lunes.setHours(0, 0, 0, 0);
  const domingo = new Date(lunes);
  domingo.setDate(lunes.getDate() + 6);
  return {
    inicio: lunes.toISOString().split('T')[0],
    fin: domingo.toISOString().split('T')[0],
    label:
      `${lunes.getDate()} ${MESES_CORTO[lunes.getMonth()]}` +
      (lunes.getMonth() !== domingo.getMonth()
        ? ` – ${domingo.getDate()} ${MESES_CORTO[domingo.getMonth()]}`
        : ` – ${domingo.getDate()} ${MESES_CORTO[domingo.getMonth()]}`),
  };
}

// Retorna { inicio, fin, label } para el mes con offset respecto al actual
function getMesRange(offset) {
  const hoy = new Date();
  const fecha = new Date(hoy.getFullYear(), hoy.getMonth() + offset, 1);
  const fin = new Date(fecha.getFullYear(), fecha.getMonth() + 1, 0);
  return {
    inicio: fecha.toISOString().split('T')[0],
    fin: fin.toISOString().split('T')[0],
    label: `${MESES_FULL[fecha.getMonth()]} ${fecha.getFullYear()}`,
  };
}

export default function FinanzasPage() {
  const [periodo, setPeriodo] = useState('semana');
  const [semanaOffset, setSemanaOffset] = useState(0); // 0 = semana actual, -1 = anterior, etc.
  const [mesOffset, setMesOffset] = useState(0);       // 0 = mes actual, -1 = anterior, etc.
  const [datos, setDatos] = useState(null);
  const [loading, setLoading] = useState(true);
  const [negocioId, setNegocioId] = useState(null);

  // Calcular rango de fechas según periodo y offset
  const getRango = useCallback(() => {
    const hoy = new Date().toISOString().split('T')[0];
    if (periodo === 'semana') return getSemanaRange(semanaOffset);
    if (periodo === 'mes') return getMesRange(mesOffset);
    return { inicio: '2020-01-01', fin: hoy, label: 'Todo el historial' };
  }, [periodo, semanaOffset, mesOffset]);

  useEffect(() => {
    supabase
      .from('productos')
      .select('negocio_id')
      .limit(1)
      .single()
      .then(({ data }) => {
        if (data?.negocio_id) setNegocioId(data.negocio_id);
      });
  }, []);

  useEffect(() => {
    if (negocioId) cargarDatos(negocioId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [negocioId, periodo, semanaOffset, mesOffset]);

  const cargarDatos = async (nid) => {
    setLoading(true);
    const { inicio, fin } = getRango();

    // Todos los pedidos entregados del periodo (todos los canales: whatsapp, local, didi, etc.)
    const { data: pedidosEntregados } = await supabase
      .from('pedidos')
      .select('total, pedido_items(cantidad)')
      .eq('negocio_id', nid)
      .eq('estado', 'entregado')
      .gte('fecha', inicio)
      .lte('fecha', fin);

    // Importaciones Didi del periodo (carga masiva desde Excel)
    const { data: importDidi } = await supabase
      .from('importaciones_didi')
      .select('venta_bruta, comision_didi, costo_promos, ganancia_neta')
      .eq('negocio_id', nid)
      .gte('fecha', inicio)
      .lte('fecha', fin);

    // Insumos del periodo
    const { data: insumos } = await supabase
      .from('compras_insumos')
      .select('monto')
      .eq('negocio_id', nid)
      .gte('fecha', inicio)
      .lte('fecha', fin);

    // Calcular totales
    const ventasPedidos     = (pedidosEntregados || []).reduce((s, p) => s + (p.total || 0), 0);
    const ventasBrutasDidi  = (importDidi || []).reduce((s, d) => s + (d.venta_bruta  || 0), 0);
    const comisionDidi      = (importDidi || []).reduce((s, d) => s + (d.comision_didi || 0), 0);
    const costoPromosDidi   = (importDidi || []).reduce((s, d) => s + (d.costo_promos  || 0), 0);
    const totalInsumos      = (insumos || []).reduce((s, i) => s + i.monto, 0);

    // ventas_brutas = pedidos entregados (todos los canales) + venta_bruta de importaciones Didi
    const ventas_brutas = ventasPedidos + ventasBrutasDidi;

    // ganancia_real = ventas_brutas - insumos - comisión Didi - promos Didi
    const ganancia_real = ventas_brutas - totalInsumos - comisionDidi - costoPromosDidi;

    const burgersPedidos = (pedidosEntregados || []).reduce(
      (s, p) => s + (p.pedido_items?.reduce((si, i) => si + i.cantidad, 0) || 0),
      0
    );
    const burgersDidi  = (importDidi || []).length; // cada fila de importación ≈ un lote
    const total_burgers = burgersPedidos + burgersDidi;

    setDatos({
      ventas_brutas,
      total_insumos:      totalInsumos,
      comision_didi:      comisionDidi,
      costo_promos_didi:  costoPromosDidi,
      ganancia_real,
      total_burgers,
      punto_equilibrio: calcularPuntoEquilibrio(totalInsumos, GANANCIA_PROMEDIO_BURGER),
    });
    setLoading(false);
  };

  const pctRetencion = datos?.ventas_brutas
    ? ((datos.ganancia_real / datos.ventas_brutas) * 100).toFixed(0)
    : 0;

  const rango = getRango();

  return (
    <div className="flex flex-col min-h-screen" style={{ background: '#0a0a0a' }}>
      <header
        className="sticky top-0 z-40 px-4 py-3"
        style={{ background: '#0a0a0a', borderBottom: '1px solid #1e1e1e' }}
      >
        <h1 className="font-bold text-lg">Mi negocio</h1>
      </header>

      <main className="flex-1 px-4 pt-4 pb-32 space-y-4">
        {/* Selector de periodo */}
        <div className="flex gap-2">
          {[
            { key: 'semana', label: 'Semana' },
            { key: 'mes', label: 'Mes' },
            { key: 'total', label: 'Todo' },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setPeriodo(key)}
              className="flex-1 py-2 rounded-xl font-bold text-sm"
              style={{
                background: periodo === key ? '#FF4D00' : '#141414',
                color: periodo === key ? '#fff' : '#888',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Navegador de semana */}
        {periodo === 'semana' && (
          <div
            className="flex items-center justify-between px-3 py-2 rounded-xl"
            style={{ background: '#141414', border: '1px solid #2a2a2a' }}
          >
            <button
              onClick={() => setSemanaOffset((o) => o - 1)}
              className="p-2 rounded-lg"
              style={{ background: '#1e1e1e' }}
            >
              <ChevronLeft size={18} style={{ color: '#aaa' }} />
            </button>
            <div className="text-center">
              <p className="text-sm font-bold text-white">{rango.label}</p>
              {semanaOffset === 0 && (
                <p className="text-xs" style={{ color: '#FF4D00' }}>Semana actual</p>
              )}
              {semanaOffset < 0 && (
                <p className="text-xs" style={{ color: '#888' }}>
                  {semanaOffset === -1 ? 'Semana pasada' : `Hace ${Math.abs(semanaOffset)} semanas`}
                </p>
              )}
            </div>
            <button
              onClick={() => setSemanaOffset((o) => Math.min(0, o + 1))}
              disabled={semanaOffset === 0}
              className="p-2 rounded-lg"
              style={{ background: '#1e1e1e', opacity: semanaOffset === 0 ? 0.3 : 1 }}
            >
              <ChevronRight size={18} style={{ color: '#aaa' }} />
            </button>
          </div>
        )}

        {/* Navegador de mes */}
        {periodo === 'mes' && (
          <div
            className="flex items-center justify-between px-3 py-2 rounded-xl"
            style={{ background: '#141414', border: '1px solid #2a2a2a' }}
          >
            <button
              onClick={() => setMesOffset((o) => o - 1)}
              className="p-2 rounded-lg"
              style={{ background: '#1e1e1e' }}
            >
              <ChevronLeft size={18} style={{ color: '#aaa' }} />
            </button>
            <div className="text-center">
              <p className="text-sm font-bold text-white">{rango.label}</p>
              {mesOffset === 0 && (
                <p className="text-xs" style={{ color: '#FF4D00' }}>Mes actual</p>
              )}
              {mesOffset < 0 && (
                <p className="text-xs" style={{ color: '#888' }}>
                  {mesOffset === -1 ? 'Mes pasado' : `Hace ${Math.abs(mesOffset)} meses`}
                </p>
              )}
            </div>
            <button
              onClick={() => setMesOffset((o) => Math.min(0, o + 1))}
              disabled={mesOffset === 0}
              className="p-2 rounded-lg"
              style={{ background: '#1e1e1e', opacity: mesOffset === 0 ? 0.3 : 1 }}
            >
              <ChevronRight size={18} style={{ color: '#aaa' }} />
            </button>
          </div>
        )}

        {/* Etiqueta periodo total */}
        {periodo === 'total' && (
          <p className="text-xs text-center" style={{ color: '#666' }}>
            Mostrando todo el historial
          </p>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <div
              className="w-8 h-8 rounded-full border-2 animate-spin"
              style={{ borderColor: '#FF4D00', borderTopColor: 'transparent' }}
            />
          </div>
        ) : datos ? (
          <>
            {/* Ganancia real — hero card */}
            <div
              className="rounded-2xl p-5 text-center"
              style={{
                background: 'linear-gradient(135deg, #141414 0%, #1a1a0a 100%)',
                border: '1px solid #2a2a0a',
              }}
            >
              <p className="text-xs font-bold tracking-widest mb-2" style={{ color: '#888' }}>
                GANANCIA REAL
              </p>
              <p
                className="text-5xl font-bold mb-1"
                style={{ color: datos.ganancia_real >= 0 ? '#22c55e' : '#ef4444' }}
              >
                {formatMXN(datos.ganancia_real)}
              </p>
              <p className="text-sm" style={{ color: '#666' }}>
                {pctRetencion}% de tus ventas brutas
              </p>
            </div>

            {/* Desglose */}
            <div className="rounded-2xl overflow-hidden" style={{ background: '#141414' }}>
              {[
                { label: 'Ventas brutas',         value:  datos.ventas_brutas,       color: '#fff'     },
                { label: '− Insumos',              value: -datos.total_insumos,       color: '#ef4444'  },
                { label: '− Comisión Didi',        value: -datos.comision_didi,       color: '#f97316'  },
                { label: '− Promos Didi',          value: -datos.costo_promos_didi,   color: '#f97316'  },
              ].map(({ label, value, color }, i, arr) => (
                <div
                  key={label}
                  className="flex items-center justify-between px-4 py-3"
                  style={{ borderBottom: i < arr.length - 1 ? '1px solid #1e1e1e' : 'none' }}
                >
                  <span style={{ color: '#aaa', fontSize: 14 }}>{label}</span>
                  <span style={{ color, fontWeight: 'bold' }}>{formatMXN(value)}</span>
                </div>
              ))}
              <div
                className="flex items-center justify-between px-4 py-3"
                style={{ background: '#1e1e1e', borderTop: '2px solid #2a2a2a' }}
              >
                <span className="font-bold text-white">= Ganancia real</span>
                <span
                  className="font-bold text-xl"
                  style={{ color: datos.ganancia_real >= 0 ? '#22c55e' : '#ef4444' }}
                >
                  {formatMXN(datos.ganancia_real)}
                </span>
              </div>
            </div>

            {/* Punto de equilibrio */}
            <div
              className="rounded-2xl p-4"
              style={{ background: '#141414', border: '1px solid #2a2a2a' }}
            >
              <p className="text-xs font-bold tracking-wider mb-3" style={{ color: '#888' }}>
                PUNTO DE EQUILIBRIO
              </p>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="text-white text-sm">Necesitas vender</p>
                  <p className="text-3xl font-bold text-white">
                    {datos.punto_equilibrio}
                    <span className="text-base font-normal ml-1" style={{ color: '#888' }}>
                      burgers
                    </span>
                  </p>
                  <p className="text-sm mt-1" style={{ color: '#888' }}>
                    para cubrir tus costos
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm" style={{ color: '#888' }}>Ya vendiste</p>
                  <p
                    className="text-3xl font-bold"
                    style={{
                      color:
                        datos.total_burgers >= datos.punto_equilibrio ? '#22c55e' : '#eab308',
                    }}
                  >
                    {datos.total_burgers}
                  </p>
                  {datos.total_burgers >= datos.punto_equilibrio && (
                    <p className="text-xs" style={{ color: '#22c55e' }}>✓ Cubierto</p>
                  )}
                </div>
              </div>

              {/* Barra de progreso */}
              <div className="h-2 rounded-full overflow-hidden mt-3" style={{ background: '#2a2a2a' }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min(
                      100,
                      (datos.total_burgers / Math.max(datos.punto_equilibrio, 1)) * 100
                    )}%`,
                    background:
                      datos.total_burgers >= datos.punto_equilibrio ? '#22c55e' : '#FF4D00',
                  }}
                />
              </div>
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
