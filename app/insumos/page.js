'use client';
import { useEffect, useState } from 'react';
import { Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import BottomNav from '@/components/BottomNav';
import { supabase } from '@/lib/supabase/client';
import { formatMXN } from '@/lib/calculos';

const CATEGORIAS = ['Carne', 'Pan', 'Verdura', 'Salsas', 'Empaque', 'Otro'];

const MESES_CORTO = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const DIAS_FULL   = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];

function getSemanaRange(offset) {
  const hoy = new Date();
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

function formatDiaLabel(fechaStr) {
  const d = new Date(fechaStr + 'T12:00:00');
  const hoy  = new Date().toISOString().split('T')[0];
  const ayer = (() => { const a = new Date(); a.setDate(a.getDate()-1); return a.toISOString().split('T')[0]; })();
  if (fechaStr === hoy)  return `Hoy · ${DIAS_FULL[d.getDay()]} ${d.getDate()} ${MESES_CORTO[d.getMonth()]}`;
  if (fechaStr === ayer) return `Ayer · ${DIAS_FULL[d.getDay()]} ${d.getDate()} ${MESES_CORTO[d.getMonth()]}`;
  return `${DIAS_FULL[d.getDay()]} ${d.getDate()} ${MESES_CORTO[d.getMonth()]}`;
}

export default function InsumosPage() {
  const [descripcion,        setDescripcion]        = useState('');
  const [monto,              setMonto]              = useState('');
  const [categoria,          setCategoria]          = useState('');
  const [fechaOpt,           setFechaOpt]           = useState('hoy');
  const [fechaPersonalizada, setFechaPersonalizada] = useState('');
  const [guardando,          setGuardando]          = useState(false);
  const [compras,            setCompras]            = useState([]);
  const [negocioId,          setNegocioId]          = useState(null);
  const [confirmEliminar,    setConfirmEliminar]    = useState(null);
  const [semanaOffset,       setSemanaOffset]       = useState(0);
  const [loadingCompras,     setLoadingCompras]     = useState(false);

  // Cargar negocioId una sola vez
  useEffect(() => {
    supabase.from('productos').select('negocio_id').limit(1).single()
      .then(({ data }) => { if (data?.negocio_id) setNegocioId(data.negocio_id); });
  }, []);

  // Recargar compras cuando cambia negocioId o semanaOffset
  useEffect(() => {
    if (negocioId) cargarCompras(negocioId, semanaOffset);
  }, [negocioId, semanaOffset]);

  const cargarCompras = async (nid, offset = 0) => {
    setLoadingCompras(true);
    const { inicio, fin } = getSemanaRange(offset);
    const { data } = await supabase
      .from('compras_insumos')
      .select('*')
      .eq('negocio_id', nid)
      .gte('fecha', inicio)
      .lte('fecha', fin)
      .order('fecha',      { ascending: false })
      .order('created_at', { ascending: false });
    if (data) setCompras(data);
    setLoadingCompras(false);
  };

  const getFecha = () => {
    const hoy = new Date();
    if (fechaOpt === 'hoy')  return hoy.toISOString().split('T')[0];
    if (fechaOpt === 'ayer') { hoy.setDate(hoy.getDate() - 1); return hoy.toISOString().split('T')[0]; }
    return fechaPersonalizada || hoy.toISOString().split('T')[0];
  };

  const canSave = descripcion.trim() && monto && (fechaOpt !== 'otra' || fechaPersonalizada);

  const guardar = async () => {
    if (!canSave || !negocioId) return;
    setGuardando(true);
    if (navigator.vibrate) navigator.vibrate(50);
    const { error } = await supabase.from('compras_insumos').insert({
      negocio_id:  negocioId,
      descripcion: descripcion.trim(),
      monto:       parseFloat(monto),
      categoria:   categoria || 'Otro',
      fecha:       getFecha(),
    });
    if (!error) {
      setDescripcion('');
      setMonto('');
      setCategoria('');
      cargarCompras(negocioId, semanaOffset);
    } else {
      alert('Error al guardar: ' + error.message);
    }
    setGuardando(false);
  };

  const eliminarCompra = async (id) => {
    const { error } = await supabase.from('compras_insumos').delete().eq('id', id);
    if (error) { alert('Error al eliminar: ' + error.message); return; }
    setCompras((prev) => prev.filter((c) => c.id !== id));
    setConfirmEliminar(null);
    if (navigator.vibrate) navigator.vibrate(100);
  };

  // Agrupar compras por día
  const comprasPorDia = {};
  compras.forEach((c) => {
    if (!comprasPorDia[c.fecha]) comprasPorDia[c.fecha] = [];
    comprasPorDia[c.fecha].push(c);
  });
  const diasOrdenados = Object.keys(comprasPorDia).sort((a, b) => b.localeCompare(a));

  const totalSemana = compras.reduce((s, c) => s + c.monto, 0);
  const rango = getSemanaRange(semanaOffset);
  const hoyStr = new Date().toISOString().split('T')[0];

  return (
    <div className="flex flex-col min-h-screen" style={{ background: '#0a0a0a' }}>
      <header
        className="sticky top-0 z-40 px-4 py-3"
        style={{ background: '#0a0a0a', borderBottom: '1px solid #1e1e1e' }}
      >
        <img src="/logo.png" alt="MR. SMASH" style={{ height: '36px', width: 'auto' }} />
      </header>

      <main className="flex-1 px-4 pt-4 pb-32 space-y-5">

        {/* ── DESCRIPCIÓN ── */}
        <div>
          <p className="text-xs font-bold tracking-wider mb-2" style={{ color: '#FF4D00' }}>
            ¿QUÉ COMPRASTE?
          </p>
          <input
            type="text"
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder="Ej: Carne 5kg, Pan 30 piezas, Salsas..."
            className="w-full px-4 py-3 rounded-xl text-white placeholder-zinc-600 outline-none"
            style={{ background: '#141414', border: '1px solid #2a2a2a', fontSize: 16 }}
          />
        </div>

        {/* ── MONTO ── */}
        <div>
          <p className="text-xs font-bold tracking-wider mb-2" style={{ color: '#888' }}>
            ¿CUÁNTO PAGASTE?
          </p>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-lg" style={{ color: '#888' }}>$</span>
            <input
              type="number"
              inputMode="decimal"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              placeholder="0"
              className="w-full pl-10 pr-4 py-3 rounded-xl text-white placeholder-zinc-600 outline-none font-bold"
              style={{ background: '#141414', border: '1px solid #2a2a2a', fontSize: 20 }}
            />
          </div>
        </div>

        {/* ── CATEGORÍA ── */}
        <div>
          <p className="text-xs font-bold tracking-wider mb-2" style={{ color: '#888' }}>CATEGORÍA</p>
          <div className="flex flex-wrap gap-2">
            {CATEGORIAS.map((cat) => (
              <button
                key={cat}
                onClick={() => setCategoria(cat)}
                className="px-4 py-2 rounded-xl font-medium text-sm"
                style={{
                  background: categoria === cat ? '#FF4D00' : '#141414',
                  color:      categoria === cat ? '#fff'    : '#888',
                  border:     `1px solid ${categoria === cat ? '#FF4D00' : '#2a2a2a'}`,
                }}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* ── FECHA ── */}
        <div>
          <p className="text-xs font-bold tracking-wider mb-2" style={{ color: '#888' }}>FECHA</p>
          <div className="flex gap-2">
            {[
              { key: 'hoy',  label: 'Hoy'  },
              { key: 'ayer', label: 'Ayer' },
              { key: 'otra', label: '📅 Otra' },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setFechaOpt(key)}
                className="flex-1 py-3 rounded-xl font-bold text-sm"
                style={{
                  background: fechaOpt === key ? '#FF4D00' : '#141414',
                  color:      fechaOpt === key ? '#fff'    : '#888',
                  border:     `1px solid ${fechaOpt === key ? '#FF4D00' : '#2a2a2a'}`,
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {fechaOpt === 'otra' && (
            <input
              type="date"
              value={fechaPersonalizada}
              max={hoyStr}
              onChange={(e) => setFechaPersonalizada(e.target.value)}
              className="mt-2 w-full px-4 py-3 rounded-xl text-white outline-none"
              style={{
                background:  '#141414',
                border:      '1px solid #FF4D00',
                fontSize:    16,
                colorScheme: 'dark',
              }}
            />
          )}
        </div>

        {/* ── BOTÓN GUARDAR ── */}
        <button
          onClick={guardar}
          disabled={!canSave || guardando}
          className="w-full py-4 rounded-2xl font-bold text-lg"
          style={{
            background: canSave ? '#FF4D00' : '#1e1e1e',
            color:      canSave ? '#fff'    : '#444',
          }}
        >
          {guardando ? 'Guardando...' : 'GUARDAR COMPRA'}
        </button>

        {/* ── DIVISOR ── */}
        <div style={{ borderTop: '1px solid #1e1e1e', marginTop: 8 }} />

        {/* ── SELECTOR DE SEMANA ── */}
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
            <p className="text-xs" style={{ color: semanaOffset === 0 ? '#FF4D00' : '#666' }}>
              {semanaOffset === 0 ? 'Semana actual' : semanaOffset === -1 ? 'Semana pasada' : `Hace ${Math.abs(semanaOffset)} semanas`}
            </p>
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

        {/* ── LISTA DE COMPRAS ── */}
        {loadingCompras ? (
          <div className="flex justify-center py-8">
            <div className="w-7 h-7 rounded-full border-2 animate-spin"
              style={{ borderColor: '#FF4D00', borderTopColor: 'transparent' }} />
          </div>
        ) : compras.length === 0 ? (
          <div className="text-center py-8" style={{ color: '#444' }}>
            <p className="text-2xl mb-2">📦</p>
            <p className="text-sm">Sin compras esta semana</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Total de la semana */}
            <div className="flex items-center justify-between px-1">
              <p className="text-xs font-bold tracking-wider" style={{ color: '#888' }}>
                TOTAL SEMANA
              </p>
              <p className="font-bold text-white text-lg">{formatMXN(totalSemana)}</p>
            </div>

            {/* Compras agrupadas por día */}
            {diasOrdenados.map((fecha) => {
              const items = comprasPorDia[fecha];
              const subtotal = items.reduce((s, c) => s + c.monto, 0);
              return (
                <div key={fecha}>
                  {/* Encabezado del día */}
                  <div className="flex items-center justify-between mb-2 px-1">
                    <p className="text-xs font-bold" style={{ color: '#FF4D00' }}>
                      {formatDiaLabel(fecha).toUpperCase()}
                    </p>
                    <p className="text-xs font-bold" style={{ color: '#888' }}>
                      {formatMXN(subtotal)}
                    </p>
                  </div>

                  {/* Items del día */}
                  <div className="space-y-2">
                    {items.map((c) => (
                      <div key={c.id} className="rounded-xl overflow-hidden" style={{ background: '#141414' }}>
                        <div className="flex items-center justify-between px-4 py-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-white text-sm font-medium truncate">{c.descripcion}</p>
                            <p className="text-xs mt-0.5" style={{ color: '#666' }}>{c.categoria}</p>
                          </div>
                          <div className="flex items-center gap-3 ml-3">
                            <span className="font-bold text-white">{formatMXN(c.monto)}</span>
                            <button
                              onClick={() => setConfirmEliminar(confirmEliminar === c.id ? null : c.id)}
                              className="p-2 rounded-lg"
                              style={{ background: confirmEliminar === c.id ? '#ef444422' : '#1e1e1e' }}
                            >
                              <Trash2 size={15} style={{ color: confirmEliminar === c.id ? '#ef4444' : '#555' }} />
                            </button>
                          </div>
                        </div>
                        {confirmEliminar === c.id && (
                          <div className="flex gap-2 px-4 pb-3">
                            <button
                              onClick={() => setConfirmEliminar(null)}
                              className="flex-1 py-2 rounded-xl text-sm font-bold"
                              style={{ background: '#1e1e1e', color: '#888' }}
                            >
                              Cancelar
                            </button>
                            <button
                              onClick={() => eliminarCompra(c.id)}
                              className="flex-1 py-2 rounded-xl text-sm font-bold"
                              style={{ background: '#ef444422', color: '#ef4444' }}
                            >
                              Confirmar borrar
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
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
