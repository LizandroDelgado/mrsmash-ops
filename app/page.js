'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Plus, RefreshCw, Pencil, ChevronDown, ChevronUp, Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import BottomNav from '@/components/BottomNav';
import EditarPedido from '@/components/EditarPedido';
import { Header } from '@/components/ui';
import { supabase } from '@/lib/supabase/client';
import { formatMXN, formatHora } from '@/lib/calculos';
import { diaOperativo, sumarDias } from '@/lib/dia';

const ESTADOS = {
  en_preparacion: { label: 'EN PREP',   color: 'var(--warn-ink)', bg: 'var(--warn-soft)' },
  listo:          { label: 'LISTO ✓',   color: 'var(--good-ink)', bg: 'var(--good-soft)' },
  entregado:      { label: 'ENTREGADO', color: 'var(--ink-mute)',    bg: 'transparent' },
};

const DIAS      = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MESES_CORTO = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

// ── Helpers de semana ──────────────────────────────────────────────────────
// "Hoy" es el día operativo de Tepic (corte 05:00), no la fecha UTC del navegador
const hoyOperativo = () => new Date(diaOperativo() + 'T12:00:00');

function getSemanaRange(offset) {
  const hoy = hoyOperativo();
  const dow = hoy.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  const lunes = new Date(hoy);
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

function getDiasDeSemana(offset) {
  const hoy    = hoyOperativo();
  const hoyStr = diaOperativo();
  const dow    = hoy.getDay();
  const diff   = dow === 0 ? -6 : 1 - dow;
  const lunes  = new Date(hoy);
  lunes.setDate(hoy.getDate() + diff + offset * 7);

  const dias = [];
  for (let i = 0; i <= 6; i++) {
    const d       = new Date(lunes);
    d.setDate(lunes.getDate() + i);
    const fechaStr = d.toISOString().split('T')[0];
    const esHoy    = fechaStr === hoyStr;
    // Semana actual: solo hasta hoy. Semanas pasadas: los 7 días.
    if (offset < 0 || d <= hoy) {
      dias.push({ fecha: fechaStr, label: esHoy ? 'Hoy' : DIAS[d.getDay()], esHoy });
    }
  }
  return dias;
}

function formatFechaCorta(fechaStr) {
  return new Date(fechaStr + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}
// ──────────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const [pedidos,         setPedidos]         = useState([]);
  const [loading,         setLoading]         = useState(true);
  const [refreshing,      setRefreshing]      = useState(false);
  const [diaSeleccionado, setDiaSeleccionado] = useState(null);   // null = hoy
  const [pedidoExpandido, setPedidoExpandido] = useState(null);
  const [editando, setEditando] = useState(null);   // pedido abierto en la hoja de edición
  const [diasSemana,      setDiasSemana]      = useState([]);
  const [semanaOffset,    setSemanaOffset]    = useState(0);      // 0 = semana actual
  const [resumenSemana,   setResumenSemana]   = useState(null);   // { totalPedidos, totalBurgers, totalIngresos }

  const hoyStr = diaOperativo();

  // Fecha efectiva para cargar pedidos del día
  const fechaEfectiva = diaSeleccionado || hoyStr;

  // Chip cuando la fecha seleccionada no está en la semana mostrada
  const diaFueraSemana = diaSeleccionado && !diasSemana.find((d) => d.fecha === diaSeleccionado);

  // ── Regenerar días y resumen al cambiar semanaOffset ─────────────────────
  useEffect(() => {
    const dias = getDiasDeSemana(semanaOffset);
    setDiasSemana(dias);

    // Día por defecto: hoy (sem. actual) o último día de la semana (historial)
    if (semanaOffset === 0) {
      setDiaSeleccionado(null);
    } else {
      setDiaSeleccionado(dias[dias.length - 1]?.fecha || null);
    }

    // Resumen de la semana
    cargarResumenSemana(semanaOffset);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [semanaOffset]);

  const cargarResumenSemana = async (offset) => {
    const { inicio, fin } = getSemanaRange(offset);
    const { data } = await supabase
      .from('pedidos')
      .select('total, pedido_items(cantidad)')
      .eq('cancelado', false)
      .eq('anulado', false)
      .gte('fecha', inicio)
      .lte('fecha', fin);
    if (!data) return;
    setResumenSemana({
      totalPedidos:   data.length,
      totalIngresos:  data.reduce((s, p) => s + (p.total || 0), 0),
      totalProductos: data.reduce(
        (s, p) => s + (p.pedido_items?.reduce((si, i) => si + i.cantidad, 0) || 0), 0
      ),
    });
  };

  // ── Cargar pedidos del día ────────────────────────────────────────────────
  const cargarPedidos = useCallback(async (fecha) => {
    const fechaBuscar = fecha || hoyStr;
    const { data, error } = await supabase
      .from('pedidos')
      .select('*, pedido_items(cantidad, precio, productos(nombre))')
      .eq('fecha', fechaBuscar)
      .eq('anulado', false)
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

  // ── Acciones ─────────────────────────────────────────────────────────────
  const cambiarEstado = async (id, estadoActual) => {
    const siguiente = estadoActual === 'en_preparacion' ? 'listo' : 'entregado';
    if (navigator.vibrate) navigator.vibrate(50);
    const { error } = await supabase.from('pedidos').update({ estado: siguiente }).eq('id', id);
    if (error) { alert('Error al actualizar estado: ' + error.message); return; }
    setPedidos((prev) => prev.map((p) => p.id === id ? { ...p, estado: siguiente } : p));
  };

  // Cancelar no borra: marca el pedido y el ledger revierte la venta (trigger en Postgres)
  const toggleCancelado = async (pedido) => {
    const cancelado = !pedido.cancelado;
    const { error } = await supabase.from('pedidos').update({ cancelado }).eq('id', pedido.id);
    if (error) { alert('Error al cancelar: ' + error.message); return; }
    if (navigator.vibrate) navigator.vibrate(50);
    setPedidos((prev) => prev.map((p) => p.id === pedido.id ? { ...p, cancelado } : p));
    cargarResumenSemana(semanaOffset);
  };

  const seleccionarFechaCalendario = (val) => {
    if (!val) return;
    const enSemana = diasSemana.find((d) => d.fecha === val);
    if (enSemana?.esHoy) setDiaSeleccionado(null);
    else                 setDiaSeleccionado(val);
    setLoading(true);
  };

  // ── Cálculos del día ─────────────────────────────────────────────────────
  const activos        = pedidos.filter((p) => !p.cancelado);
  const totalDia       = activos.reduce((s, p) => s + (p.total || 0), 0);
  const totalProductos = activos.reduce(
    (s, p) => s + (p.pedido_items?.reduce((si, i) => si + i.cantidad, 0) || 0), 0
  );
  const fechaSeleccionada = diaSeleccionado || hoyStr;
  const rango = getSemanaRange(semanaOffset);

  return (
    <div className="flex flex-col min-h-screen" style={{ background: 'var(--cream)' }}>

      {/* ── Header ── */}
      <Header titulo="Pedidos"
        subtitulo={new Date(fechaSeleccionada + 'T12:00:00').toLocaleDateString('es-MX', {
          weekday: 'long', day: 'numeric', month: 'short',
        })}
        right={
        <div className="flex items-center gap-2">
          <button onClick={() => { setRefreshing(true); cargarPedidos(diaSeleccionado); }} aria-label="Actualizar"
            className="flex items-center justify-center rounded-full" style={{ width: 48, background: 'var(--paper)', border: '1px solid var(--line)' }}>
            <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} style={{ color: 'var(--ink-soft)' }} />
          </button>
          <Link href="/nuevo-pedido"
            className="btn-accent flex items-center gap-1 px-3 rounded-full font-display text-base"
            style={{ minHeight: 48, fontWeight: 600 }}>
            <Plus size={18} strokeWidth={2.5} />Pedido
          </Link>
        </div>
      } />

      {/* ── Navegador de semana ── */}
      <div className="flex items-center justify-between px-3 py-2 mx-4 mt-3 rounded-xl"
        style={{ background: 'var(--paper)', border: '1px solid var(--line)' }}>
        <button onClick={() => setSemanaOffset((o) => o - 1)}
          className="p-2 rounded-full" style={{ background: 'var(--paper-2)' }}>
          <ChevronLeft size={18} style={{ color: 'var(--ink-soft)' }} />
        </button>
        <div className="text-center">
          <p className="text-sm font-bold text-ink">{rango.label}</p>
          <p className="text-xs" style={{ color: semanaOffset === 0 ? 'var(--orange-text)' : 'var(--ink-mute)' }}>
            {semanaOffset === 0 ? 'Semana actual' : semanaOffset === -1 ? 'Semana pasada' : `Hace ${Math.abs(semanaOffset)} semanas`}
          </p>
        </div>
        <button onClick={() => setSemanaOffset((o) => Math.min(0, o + 1))}
          disabled={semanaOffset === 0}
          className="p-2 rounded-full"
          style={{ background: 'var(--paper-2)', opacity: semanaOffset === 0 ? 0.3 : 1 }}>
          <ChevronRight size={18} style={{ color: 'var(--ink-soft)' }} />
        </button>
      </div>

      {/* ── Resumen de la semana ── */}
      {resumenSemana && (
        <div className="grid grid-cols-3 gap-2 px-4 pt-2">
          {[
            { label: 'Pedidos sem.',   value: resumenSemana.totalPedidos   },
            { label: 'Productos sem.', value: resumenSemana.totalProductos },
            { label: 'Ingresos sem.', value: formatMXN(resumenSemana.totalIngresos) },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-xl p-2 text-center" style={{ background: 'var(--paper)', border: '1px solid var(--line)' }}>
              <p className="text-base font-bold" style={{ color: 'var(--orange-text)' }}>{value}</p>
              <p className="text-xs" style={{ color: 'var(--ink-mute)' }}>{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Selector de días + botón calendario ── */}
      <div className="flex gap-1 px-4 pt-2 pb-1 overflow-x-auto items-center">
        {diasSemana.map((d) => (
          <button key={d.fecha}
            onClick={() => { setDiaSeleccionado(d.esHoy ? null : d.fecha); setLoading(true); }}
            className="flex-shrink-0 px-3 py-2 rounded-full text-xs font-bold"
            style={{
              background: (d.esHoy && !diaSeleccionado) || diaSeleccionado === d.fecha ? 'var(--orange-fill)' : 'var(--paper)',
              color:      (d.esHoy && !diaSeleccionado) || diaSeleccionado === d.fecha ? 'var(--on-orange)'    : 'var(--ink-soft)',
            }}>
            {d.label}
          </button>
        ))}

        {/* Chip: fecha fuera de la semana mostrada */}
        {diaFueraSemana && (
          <button
            onClick={() => { setDiaSeleccionado(null); setLoading(true); }}
            className="flex-shrink-0 flex items-center gap-1 px-3 py-2 rounded-full text-xs font-bold"
            style={{ background: 'var(--orange-fill)', color: 'var(--on-orange)' }}>
            {formatFechaCorta(diaSeleccionado)}
            <span style={{ fontSize: 14, lineHeight: 1 }}>×</span>
          </button>
        )}

        {/* Botón calendario */}
        <div className="flex-shrink-0 relative ml-auto">
          <input type="date" max={hoyStr}
            onChange={(e) => seleccionarFechaCalendario(e.target.value)}
            style={{ opacity: 0, position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: 'pointer', zIndex: 1 }}
          />
          <div className="flex items-center justify-center rounded-full" aria-label="Elegir fecha"
            style={{ background: 'var(--paper)', border: '1px solid var(--line)', width: 48, height: 48 }}>
            <Calendar size={18} style={{ color: diaFueraSemana ? 'var(--orange-text)' : 'var(--ink-soft)' }} />
          </div>
        </div>
      </div>

      {/* ── KPIs del día ── */}
      <div className="grid grid-cols-3 gap-2 px-4 pt-2 pb-2">
        {[
          { label: 'Pedidos hoy',   value: activos.length  },
          { label: 'Productos hoy', value: totalProductos  },
          { label: 'Ingresos hoy',  value: formatMXN(totalDia) },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-xl p-3 text-center" style={{ background: 'var(--paper)', border: '1px solid var(--line)' }}>
            <p className="text-lg font-bold text-ink">{value}</p>
            <p className="text-xs" style={{ color: 'var(--ink-mute)' }}>{label}</p>
          </div>
        ))}
      </div>

      {/* ── Lista de pedidos del día ── */}
      <main className="flex-1 px-4 pb-32 pt-1">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 rounded-full border-2 animate-spin"
              style={{ borderColor: 'var(--orange)', borderTopColor: 'transparent' }} />
          </div>
        ) : pedidos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <p className="text-4xl">🍔</p>
            <p className="font-bold text-ink">Sin pedidos este día</p>
          </div>
        ) : (
          <div className="space-y-3 mt-1">
            {pedidos.map((pedido) => {
              const est          = pedido.cancelado
                ? { label: 'CANCELADO', color: 'var(--bad-ink)' }
                : ESTADOS[pedido.estado] || ESTADOS.en_preparacion;
              const items        = pedido.pedido_items || [];
              const resumenItems = items.map((i) => `${i.cantidad}x ${i.productos?.nombre || '?'}`).join(' · ');
              const expandido    = pedidoExpandido === pedido.id;

              return (
                <div key={pedido.id} className="rounded-2xl overflow-hidden"
                  style={{ background: 'var(--paper)', border: '1px solid var(--line)' }}>

                  <div className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold tracking-wider px-2 py-0.5 rounded-full"
                        style={{ background: est.bg || 'var(--bad-soft)', color: est.color }}>
                        {est.label}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs" style={{ color: 'var(--ink-mute)' }}>{formatHora(pedido.hora)}</span>
                        <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--paper-2)', color: 'var(--ink-soft)' }}>
                          {pedido.canal === 'whatsapp' ? 'WA' : pedido.canal === 'didi' ? 'Didi' : pedido.canal === 'salon' ? 'Salón' : 'Manual'}
                        </span>
                      </div>
                    </div>

                    {pedido.cliente_nombre && (
                      <p className="font-bold text-ink text-sm mb-1">{pedido.cliente_nombre}</p>
                    )}
                    <p className="text-sm mb-1" style={{ color: 'var(--ink-soft)' }}>{resumenItems || 'Sin items'}</p>
                    {pedido.notas && (
                      <p className="text-xs italic" style={{ color: 'var(--orange-text)' }}>📝 {pedido.notas}</p>
                    )}

                    <div className="flex items-center justify-between mt-3">
                      <span className="font-bold text-ink" style={pedido.cancelado ? { textDecoration: 'line-through', color: 'var(--ink-mute)' } : undefined}>
                        {formatMXN(pedido.total)}
                        {pedido.metodo_pago && pedido.metodo_pago !== 'didi' && (
                          <span className="text-xs font-normal ml-2" style={{ color: 'var(--ink-mute)' }}>{pedido.metodo_pago}</span>
                        )}
                      </span>
                      <div className="flex items-center gap-2">
                        {pedido.estado !== 'entregado' && !pedido.cancelado && (
                          <button onClick={() => cambiarEstado(pedido.id, pedido.estado)}
                            className="px-4 py-2 rounded-full font-bold text-sm"
                            style={{ background: pedido.estado === 'en_preparacion' ? 'var(--orange-fill)' : 'var(--good-ink)', color: 'var(--on-orange)' }}>
                            {pedido.estado === 'en_preparacion' ? 'LISTO ✓' : 'ENTREGADO'}
                          </button>
                        )}
                        <button onClick={() => setPedidoExpandido(expandido ? null : pedido.id)}
                          className="p-2 rounded-full" style={{ background: 'var(--paper-2)' }}>
                          {expandido
                            ? <ChevronUp   size={16} style={{ color: 'var(--ink-soft)' }} />
                            : <ChevronDown size={16} style={{ color: 'var(--ink-soft)' }} />}
                        </button>
                      </div>
                    </div>
                  </div>

                  {expandido && (
                    <div className="px-4 pb-4 pt-0" style={{ borderTop: '1px solid var(--paper-2)' }}>
                      <div className="pt-3 space-y-2">
                        {items.map((item, idx) => (
                          <div key={idx} className="flex justify-between text-sm">
                            <span style={{ color: 'var(--ink-soft)' }}>{item.cantidad}x {item.productos?.nombre}</span>
                            <span style={{ color: 'var(--ink)' }}>{formatMXN(item.precio * item.cantidad)}</span>
                          </div>
                        ))}
                        <div className="flex justify-between text-sm pt-2" style={{ borderTop: '1px solid var(--line)' }}>
                          <span style={{ color: 'var(--ink-soft)' }}>Total</span>
                          <span className="font-bold" style={{ color: 'var(--ink)' }}>{formatMXN(pedido.total)}</span>
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <button onClick={() => setEditando(pedido.id)}
                          className="btn-accent flex items-center justify-center gap-1.5 text-sm rounded-full font-display"
                          style={{ minHeight: 48 }}>
                          <Pencil size={15} /> Editar
                        </button>
                        <button onClick={() => toggleCancelado(pedido)}
                          className="flex items-center justify-center gap-1.5 text-sm rounded-full"
                          style={{ color: pedido.cancelado ? 'var(--good-ink)' : 'var(--warn-ink)', background: 'var(--paper)', border: '1px solid var(--line)', minHeight: 48 }}>
                          {pedido.cancelado ? '↺ Reactivar' : '⊘ Cancelar pedido'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>

      {editando && (
        <EditarPedido pedidoId={editando} onClose={() => setEditando(null)}
          onGuardado={() => { setEditando(null); cargarPedidos(diaSeleccionado); cargarResumenSemana(semanaOffset); }} />
      )}

      <BottomNav />
    </div>
  );
}
