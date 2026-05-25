'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Plus, RefreshCw, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import BottomNav from '@/components/BottomNav';
import { supabase } from '@/lib/supabase/client';
import { formatMXN, formatHora } from '@/lib/calculos';
 
const ESTADOS = {
  en_preparacion: { label: 'EN PREP', color: '#eab308', bg: 'rgba(234,179,8,0.08)' },
  listo: { label: 'LISTO ✓', color: '#22c55e', bg: 'rgba(34,197,94,0.08)' },
  entregado: { label: 'ENTREGADO', color: '#555', bg: 'transparent' },
};
 
const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
 
export default function HomePage() {
  const [pedidos, setPedidos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [diaSeleccionado, setDiaSeleccionado] = useState(null); // null = hoy
  const [pedidoExpandido, setPedidoExpandido] = useState(null);
  const [confirmEliminar, setConfirmEliminar] = useState(null);
  const [diasSemana, setDiasSemana] = useState([]);
 
  // Generar días de la semana actual (lunes a hoy)
  useEffect(() => {
    const hoy = new Date();
    const diaSemana = hoy.getDay(); // 0=dom
    const lunes = new Date(hoy);
    const diff = diaSemana === 0 ? -6 : 1 - diaSemana;
    lunes.setDate(hoy.getDate() + diff);
 
    const dias = [];
    for (let i = 0; i <= 6; i++) {
      const d = new Date(lunes);
      d.setDate(lunes.getDate() + i);
      if (d <= hoy) {
        dias.push({
          fecha: d.toISOString().split('T')[0],
          label: i === (diaSemana === 0 ? 6 : diaSemana - 1) ? 'Hoy' : DIAS[d.getDay()],
          esHoy: d.toISOString().split('T')[0] === hoy.toISOString().split('T')[0],
        });
      }
    }
    setDiasSemana(dias);
  }, []);
 
  const cargarPedidos = useCallback(async (fecha) => {
    const fechaBuscar = fecha || new Date().toISOString().split('T')[0];
    const { data, error } = await supabase
      .from('pedidos')
      .select(`*, pedido_items(cantidad, precio, productos(nombre))`)
      .eq('fecha', fechaBuscar)
      .order('created_at', { ascending: false });
 
    if (!error && data) setPedidos(data);
    setLoading(false);
    setRefreshing(false);
  }, []);
 
  useEffect(() => {
    cargarPedidos(diaSeleccionado);
 
    const channel = supabase.channel('pedidos-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' },
        () => cargarPedidos(diaSeleccionado))
      .subscribe();
 
    return () => supabase.removeChannel(channel);
  }, [cargarPedidos, diaSeleccionado]);
 
  const cambiarEstado = async (id, estadoActual) => {
    const siguiente = estadoActual === 'en_preparacion' ? 'listo' : 'entregado';
    if (navigator.vibrate) navigator.vibrate(50);
    setPedidos((prev) => prev.map((p) => p.id === id ? { ...p, estado: siguiente } : p));
    await supabase.from('pedidos').update({ estado: siguiente }).eq('id', id);
  };
 
  const eliminarPedido = async (id) => {
    // Primero eliminar en Supabase, luego actualizar estado local
    const { error: errItems } = await supabase.from('pedido_items').delete().eq('pedido_id', id);
    if (errItems) { alert('Error al eliminar items. Intenta de nuevo.'); return; }
    const { error: errPedido } = await supabase.from('pedidos').delete().eq('id', id);
    if (errPedido) { alert('Error al eliminar pedido. Intenta de nuevo.'); return; }
    // Solo actualizar estado local si Supabase confirmó la eliminación
    setPedidos((prev) => prev.filter((p) => p.id !== id));
    setConfirmEliminar(null);
    if (navigator.vibrate) navigator.vibrate(100);
  };
 
  const pedidosActivos = pedidos.filter((p) => p.estado !== 'entregado');
  const totalDia = pedidos.reduce((s, p) => s + (p.total || 0), 0);
  const burgersTotal = pedidos.reduce((s, p) => s + (p.pedido_items?.reduce((si, i) => si + i.cantidad, 0) || 0), 0);
 
  const fechaSeleccionada = diaSeleccionado || new Date().toISOString().split('T')[0];
 
  return (
    <div className="flex flex-col min-h-screen" style={{ background: '#0a0a0a' }}>
      {/* Header */}
      <header className="sticky top-0 z-40 flex items-center justify-between px-4 py-3"
        style={{ background: '#0a0a0a', borderBottom: '1px solid #1e1e1e' }}>
        <div>
          <p className="text-xs font-bold tracking-widest" style={{ color: '#FF4D00' }}>MR. SMASH</p>
          <p className="text-xs" style={{ color: '#555' }}>
            {new Date(fechaSeleccionada + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'short' })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { setRefreshing(true); cargarPedidos(diaSeleccionado); }}
            className="p-2 rounded-lg" style={{ background: '#1e1e1e' }}>
            <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} style={{ color: '#888' }} />
          </button>
          <Link href="/nuevo-pedido"
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl font-bold text-sm"
            style={{ background: '#FF4D00', color: '#fff' }}>
            <Plus size={18} strokeWidth={2.5} />Pedido
          </Link>
        </div>
      </header>
 
      {/* Selector de días de la semana */}
      {diasSemana.length > 1 && (
        <div className="flex gap-1 px-4 pt-3 pb-1 overflow-x-auto">
          {diasSemana.map((d) => (
            <button key={d.fecha}
              onClick={() => { setDiaSeleccionado(d.esHoy ? null : d.fecha); setLoading(true); }}
              className="flex-shrink-0 px-3 py-2 rounded-xl text-xs font-bold"
              style={{
                background: (d.esHoy && !diaSeleccionado) || diaSeleccionado === d.fecha ? '#FF4D00' : '#141414',
                color: (d.esHoy && !diaSeleccionado) || diaSeleccionado === d.fecha ? '#fff' : '#888',
              }}>
              {d.label}
            </button>
          ))}
        </div>
      )}
 
      {/* KPIs */}
      <div className="grid grid-cols-3 gap-2 px-4 pt-3 pb-2">
        {[
          { label: 'Pedidos', value: pedidos.length },
          { label: 'Burgers', value: burgersTotal },
          { label: 'Ingresos', value: formatMXN(totalDia) },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-xl p-3 text-center" style={{ background: '#141414' }}>
            <p className="text-lg font-bold text-white">{value}</p>
            <p className="text-xs" style={{ color: '#666' }}>{label}</p>
          </div>
        ))}
      </div>
 
      {/* Lista de pedidos */}
      <main className="flex-1 px-4 pb-32 pt-2">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 rounded-full border-2 animate-spin"
              style={{ borderColor: '#FF4D00', borderTopColor: 'transparent' }} />
          </div>
        ) : pedidos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <p className="text-4xl">🍔</p>
            <p className="font-bold text-white">Sin pedidos este día</p>
          </div>
        ) : (
          <div className="space-y-3 mt-2">
            {pedidos.map((pedido) => {
              const est = ESTADOS[pedido.estado] || ESTADOS.en_preparacion;
              const items = pedido.pedido_items || [];
              const resumenItems = items.map((i) => `${i.cantidad}x ${i.productos?.nombre || '?'}`).join(' · ');
              const expandido = pedidoExpandido === pedido.id;
 
              return (
                <div key={pedido.id} className="rounded-2xl overflow-hidden"
                  style={{ background: '#141414', border: `1px solid ${est.color}22` }}>
                  
                  {/* Header de tarjeta */}
                  <div className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold tracking-wider px-2 py-0.5 rounded-full"
                        style={{ background: `${est.color}22`, color: est.color }}>
                        {est.label}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs" style={{ color: '#666' }}>{formatHora(pedido.hora)}</span>
                        <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: '#1e1e1e', color: '#888' }}>
                          {pedido.canal === 'whatsapp' ? 'WA' : pedido.canal === 'didi' ? 'Didi' : 'Manual'}
                        </span>
                      </div>
                    </div>
 
                    {pedido.cliente_nombre && (
                      <p className="font-bold text-white text-sm mb-1">{pedido.cliente_nombre}</p>
                    )}
                    <p className="text-sm mb-1" style={{ color: '#aaa' }}>{resumenItems || 'Sin items'}</p>
                    {pedido.notas && (
                      <p className="text-xs italic" style={{ color: '#FF4D00' }}>📝 {pedido.notas}</p>
                    )}
 
                    <div className="flex items-center justify-between mt-3">
                      <span className="font-bold text-white">{formatMXN(pedido.total)}</span>
                      <div className="flex items-center gap-2">
                        {pedido.estado !== 'entregado' && (
                          <button onClick={() => cambiarEstado(pedido.id, pedido.estado)}
                            className="px-4 py-2 rounded-xl font-bold text-sm"
                            style={{ background: pedido.estado === 'en_preparacion' ? '#FF4D00' : '#22c55e', color: '#fff' }}>
                            {pedido.estado === 'en_preparacion' ? 'LISTO ✓' : 'ENTREGADO'}
                          </button>
                        )}
                        <button onClick={() => setPedidoExpandido(expandido ? null : pedido.id)}
                          className="p-2 rounded-xl" style={{ background: '#1e1e1e' }}>
                          {expandido ? <ChevronUp size={16} style={{ color: '#888' }} /> : <ChevronDown size={16} style={{ color: '#888' }} />}
                        </button>
                      </div>
                    </div>
                  </div>
 
                  {/* Detalle expandido */}
                  {expandido && (
                    <div className="px-4 pb-4 pt-0" style={{ borderTop: '1px solid #1e1e1e' }}>
                      <div className="pt-3 space-y-2">
                        {items.map((item, idx) => (
                          <div key={idx} className="flex justify-between text-sm">
                            <span style={{ color: '#aaa' }}>{item.cantidad}x {item.productos?.nombre}</span>
                            <span style={{ color: '#fff' }}>{formatMXN(item.precio * item.cantidad)}</span>
                          </div>
                        ))}
                        <div className="flex justify-between text-sm pt-2" style={{ borderTop: '1px solid #2a2a2a' }}>
                          <span style={{ color: '#888' }}>Total</span>
                          <span className="font-bold" style={{ color: '#fff' }}>{formatMXN(pedido.total)}</span>
                        </div>
                      </div>
 
                      {/* Botón eliminar */}
                      {confirmEliminar === pedido.id ? (
                        <div className="mt-3 flex gap-2">
                          <button onClick={() => setConfirmEliminar(null)}
                            className="flex-1 py-2 rounded-xl text-sm font-bold"
                            style={{ background: '#1e1e1e', color: '#888' }}>
                            Cancelar
                          </button>
                          <button onClick={() => eliminarPedido(pedido.id)}
                            className="flex-1 py-2 rounded-xl text-sm font-bold"
                            style={{ background: '#ef444422', color: '#ef4444' }}>
                            Confirmar borrar
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => setConfirmEliminar(pedido.id)}
                          className="mt-3 flex items-center gap-2 text-sm py-2 px-3 rounded-xl"
                          style={{ color: '#ef4444', background: '#ef444411' }}>
                          <Trash2 size={14} /> Eliminar pedido
                        </button>
                      )}
                    </div>
                  )}
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