'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Plus, RefreshCw } from 'lucide-react';
import BottomNav from '@/components/BottomNav';
import { supabase } from '@/lib/supabase/client';
import { formatMXN, formatHora } from '@/lib/calculos';

const ESTADOS = {
  en_preparacion: { label: 'EN PREP', color: '#eab308', bg: 'rgba(234,179,8,0.08)' },
  listo: { label: 'LISTO ✓', color: '#22c55e', bg: 'rgba(34,197,94,0.08)' },
  entregado: { label: 'ENTREGADO', color: '#555', bg: 'transparent' },
};

const NEGOCIO_ID = process.env.NEXT_PUBLIC_NEGOCIO_ID;

export default function HomePage() {
  const [pedidos, setPedidos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const cargarPedidos = useCallback(async () => {
    const hoy = new Date().toISOString().split('T')[0];
    const { data, error } = await supabase
      .from('pedidos')
      .select(`
        *,
        pedido_items (
          cantidad,
          precio,
          productos ( nombre )
        )
      `)
      .eq('fecha', hoy)
      .eq('canal', 'whatsapp')
      .order('created_at', { ascending: false });

    if (!error && data) setPedidos(data);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    cargarPedidos();

    // Realtime subscription
    const channel = supabase
      .channel('pedidos-hoy')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'pedidos',
      }, () => cargarPedidos())
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [cargarPedidos]);

  const cambiarEstado = async (id, estadoActual) => {
    const siguiente = estadoActual === 'en_preparacion' ? 'listo' : 'entregado';
    if (navigator.vibrate) navigator.vibrate(50);

    // Optimistic update
    setPedidos((prev) =>
      prev.map((p) => (p.id === id ? { ...p, estado: siguiente } : p))
    );

    await supabase.from('pedidos').update({ estado: siguiente }).eq('id', id);
  };

  const pedidosActivos = pedidos.filter((p) => p.estado !== 'entregado');
  const totalHoy = pedidos.reduce((s, p) => s + (p.total || 0), 0);
  const burgersHoy = pedidos.reduce(
    (s, p) => s + (p.pedido_items?.reduce((si, i) => si + i.cantidad, 0) || 0),
    0
  );

  return (
    <div className="flex flex-col min-h-screen" style={{ background: '#0a0a0a' }}>
      {/* Header */}
      <header
        className="sticky top-0 z-40 flex items-center justify-between px-4 py-3"
        style={{ background: '#0a0a0a', borderBottom: '1px solid #1e1e1e' }}
      >
        <div>
          <p className="text-xs font-bold tracking-widest" style={{ color: '#FF4D00' }}>
            MR. SMASH
          </p>
          <p className="text-xs" style={{ color: '#555' }}>
            {new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'short' })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setRefreshing(true); cargarPedidos(); }}
            className="p-2 rounded-lg"
            style={{ background: '#1e1e1e' }}
          >
            <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} style={{ color: '#888' }} />
          </button>
          <Link
            href="/nuevo-pedido"
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl font-bold text-sm"
            style={{ background: '#FF4D00', color: '#fff' }}
          >
            <Plus size={18} strokeWidth={2.5} />
            Pedido
          </Link>
        </div>
      </header>

      {/* KPIs del día */}
      <div className="grid grid-cols-3 gap-2 px-4 pt-4 pb-2">
        {[
          { label: 'Pedidos', value: pedidos.length },
          { label: 'Burgers', value: burgersHoy },
          { label: 'Ingresos', value: formatMXN(totalHoy) },
        ].map(({ label, value }) => (
          <div
            key={label}
            className="rounded-xl p-3 text-center"
            style={{ background: '#141414' }}
          >
            <p className="text-lg font-bold text-white">{value}</p>
            <p className="text-xs" style={{ color: '#666' }}>{label}</p>
          </div>
        ))}
      </div>

      {/* Cola de pedidos */}
      <main className="flex-1 px-4 pb-32 pt-2">
        {loading ? (
          <div className="flex justify-center py-12">
            <div
              className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
              style={{ borderColor: '#FF4D00', borderTopColor: 'transparent' }}
            />
          </div>
        ) : pedidosActivos.length === 0 && pedidos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <p className="text-4xl">🍔</p>
            <p className="font-bold text-white">Sin pedidos hoy</p>
            <p className="text-sm" style={{ color: '#666' }}>Toca "+ Pedido" para empezar</p>
          </div>
        ) : (
          <div className="space-y-3 mt-2">
            {pedidos.map((pedido) => {
              const est = ESTADOS[pedido.estado] || ESTADOS.en_preparacion;
              const items = pedido.pedido_items || [];
              const resumenItems = items
                .map((i) => `${i.cantidad}x ${i.productos?.nombre || '?'}`)
                .join('  ·  ');

              return (
                <div
                  key={pedido.id}
                  className="rounded-2xl p-4"
                  style={{ background: est.bg || '#141414', border: `1px solid ${est.color}22` }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span
                      className="text-xs font-bold tracking-wider px-2 py-0.5 rounded-full"
                      style={{ background: `${est.color}22`, color: est.color }}
                    >
                      {est.label}
                    </span>
                    <span className="text-xs" style={{ color: '#666' }}>
                      {formatHora(pedido.hora)}
                    </span>
                  </div>

                  {pedido.cliente_nombre && (
                    <p className="font-bold text-white text-sm mb-1">
                      {pedido.cliente_nombre}
                    </p>
                  )}

                  <p className="text-sm mb-2" style={{ color: '#aaa' }}>
                    {resumenItems || 'Sin items'}
                  </p>

                  {pedido.notas && (
                    <p className="text-xs mb-2 italic" style={{ color: '#FF4D00' }}>
                      📝 {pedido.notas}
                    </p>
                  )}

                  <div className="flex items-center justify-between mt-3">
                    <span className="font-bold text-white">{formatMXN(pedido.total)}</span>
                    {pedido.estado !== 'entregado' && (
                      <button
                        onClick={() => cambiarEstado(pedido.id, pedido.estado)}
                        className="px-5 py-2 rounded-xl font-bold text-sm"
                        style={{
                          background: pedido.estado === 'en_preparacion' ? '#FF4D00' : '#22c55e',
                          color: '#fff',
                        }}
                      >
                        {pedido.estado === 'en_preparacion' ? 'LISTO ✓' : 'ENTREGADO'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      <BottomNav />
    </div>
  );
}
