'use client';
import { useEffect, useState } from 'react';
import BottomNav from '@/components/BottomNav';
import { supabase } from '@/lib/supabase/client';
import { formatMXN, calcularPuntoEquilibrio, getInicioSemana } from '@/lib/calculos';

const GANANCIA_PROMEDIO_BURGER = 58; // promedio de los 4 productos

export default function FinanzasPage() {
  const [periodo, setPeriodo] = useState('semana');
  const [datos, setDatos] = useState(null);
  const [loading, setLoading] = useState(true);
  const [negocioId, setNegocioId] = useState(null);

  useEffect(() => {
    supabase
      .from('productos')
      .select('negocio_id')
      .limit(1)
      .single()
      .then(({ data }) => {
        if (data?.negocio_id) {
          setNegocioId(data.negocio_id);
          cargarDatos(data.negocio_id, 'semana');
        }
      });
  }, []);

  useEffect(() => {
    if (negocioId) cargarDatos(negocioId, periodo);
  }, [periodo, negocioId]);

  const cargarDatos = async (nid, p) => {
    setLoading(true);
    const hoy = new Date();
    let fechaInicio;

    if (p === 'semana') {
      fechaInicio = getInicioSemana();
    } else if (p === 'mes') {
      fechaInicio = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-01`;
    } else {
      fechaInicio = '2020-01-01';
    }

    // Pedidos WhatsApp del periodo
    const { data: pedidosWA } = await supabase
      .from('pedidos')
      .select('total, pedido_items(cantidad, precio, costo)')
      .eq('negocio_id', nid)
      .eq('canal', 'whatsapp')
      .gte('fecha', fechaInicio);

    // Importaciones Didi del periodo
    const { data: pedidosDidi } = await supabase
      .from('importaciones_didi')
      .select('venta_bruta, comision_didi, costo_promos, ganancia_neta')
      .eq('negocio_id', nid)
      .gte('fecha', fechaInicio);

    // Insumos del periodo
    const { data: insumos } = await supabase
      .from('compras_insumos')
      .select('monto')
      .eq('negocio_id', nid)
      .gte('fecha', fechaInicio);

    // Calcular totales
    const ventasWA = (pedidosWA || []).reduce((s, p) => s + (p.total || 0), 0);
    const ventasDidi = (pedidosDidi || []).reduce((s, p) => s + (p.venta_bruta || 0), 0);
    const gananciaNetaDidi = (pedidosDidi || []).reduce((s, p) => s + (p.ganancia_neta || 0), 0);
    const comisionDidi = (pedidosDidi || []).reduce((s, p) => s + (p.comision_didi || 0), 0);
    const totalInsumos = (insumos || []).reduce((s, i) => s + i.monto, 0);

    const ventas_brutas = ventasWA + ventasDidi;
    const ganancia_real = ventasWA + gananciaNetaDidi - totalInsumos;

    const burgersWA = (pedidosWA || []).reduce(
      (s, p) => s + (p.pedido_items?.reduce((si, i) => si + i.cantidad, 0) || 0),
      0
    );
    const burgersDidi = (pedidosDidi || []).length; // aprox, cada importacion = 1 pedido
    const total_burgers = burgersWA + burgersDidi;

    // Por producto
    const porProducto = {};
    (pedidosWA || []).forEach((p) => {
      (p.pedido_items || []).forEach((item) => {
        if (!porProducto[item.precio]) {
          porProducto[item.precio] = { ventas: 0, cantidad: 0 };
        }
        porProducto[item.precio].ventas += item.precio * item.cantidad;
        porProducto[item.precio].cantidad += item.cantidad;
      });
    });

    setDatos({
      ventas_brutas,
      total_insumos: totalInsumos,
      comision_didi: comisionDidi,
      ganancia_real,
      total_burgers,
      punto_equilibrio: calcularPuntoEquilibrio(totalInsumos, GANANCIA_PROMEDIO_BURGER),
    });
    setLoading(false);
  };

  const pctRetencion = datos?.ventas_brutas
    ? ((datos.ganancia_real / datos.ventas_brutas) * 100).toFixed(0)
    : 0;

  return (
    <div className="flex flex-col min-h-screen" style={{ background: '#0a0a0a' }}>
      <header
        className="sticky top-0 z-40 px-4 py-3"
        style={{ background: '#0a0a0a', borderBottom: '1px solid #1e1e1e' }}
      >
        <h1 className="font-bold text-lg">Mi negocio</h1>
      </header>

      <main className="flex-1 px-4 pt-4 pb-32 space-y-4">
        {/* Selector periodo */}
        <div className="flex gap-2">
          {['semana', 'mes', 'total'].map((p) => (
            <button
              key={p}
              onClick={() => setPeriodo(p)}
              className="flex-1 py-2 rounded-xl font-bold text-sm capitalize"
              style={{
                background: periodo === p ? '#FF4D00' : '#141414',
                color: periodo === p ? '#fff' : '#888',
              }}
            >
              {p === 'semana' ? 'Semana' : p === 'mes' ? 'Mes' : 'Todo'}
            </button>
          ))}
        </div>

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
              style={{ background: 'linear-gradient(135deg, #141414 0%, #1a1a0a 100%)', border: '1px solid #2a2a0a' }}
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
                { label: 'Ventas brutas', value: datos.ventas_brutas, color: '#fff' },
                { label: '− Insumos', value: -datos.total_insumos, color: '#ef4444' },
                { label: '− Comisión Didi', value: -datos.comision_didi, color: '#f97316' },
              ].map(({ label, value, color }, i) => (
                <div
                  key={label}
                  className="flex items-center justify-between px-4 py-3"
                  style={{ borderBottom: i < 2 ? '1px solid #1e1e1e' : 'none' }}
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
            <div className="rounded-2xl p-4" style={{ background: '#141414', border: '1px solid #2a2a2a' }}>
              <p className="text-xs font-bold tracking-wider mb-3" style={{ color: '#888' }}>
                PUNTO DE EQUILIBRIO
              </p>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="text-white text-sm">Necesitas vender</p>
                  <p className="text-3xl font-bold text-white">
                    {datos.punto_equilibrio}
                    <span className="text-base font-normal ml-1" style={{ color: '#888' }}>burgers</span>
                  </p>
                  <p className="text-sm mt-1" style={{ color: '#888' }}>
                    para cubrir tus costos
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm" style={{ color: '#888' }}>Ya vendiste</p>
                  <p
                    className="text-3xl font-bold"
                    style={{ color: datos.total_burgers >= datos.punto_equilibrio ? '#22c55e' : '#eab308' }}
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
                    width: `${Math.min(100, (datos.total_burgers / Math.max(datos.punto_equilibrio, 1)) * 100)}%`,
                    background: datos.total_burgers >= datos.punto_equilibrio ? '#22c55e' : '#FF4D00',
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
