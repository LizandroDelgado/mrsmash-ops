'use client';
import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Package, Pencil } from 'lucide-react';
import BottomNav from '@/components/BottomNav';
import { Header } from '@/components/ui';
import { supabase } from '@/lib/supabase/client';
import { formatMXN } from '@/lib/calculos';
import { diaOperativo, sumarDias, formatDiaCorto } from '@/lib/dia';
import { METODOS_COMPRA } from '@/lib/negocio';
import DesgloseCompra from '@/components/DesgloseCompra';
import EditarCompra from '@/components/EditarCompra';
import MasMenu from '@/components/MasMenu';

const CATEGORIAS = ['Carne', 'Pan', 'Verdura', 'Salsas', 'Empaque', 'Otro'];

const MESES_CORTO = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const DIAS_FULL   = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];

function getSemanaRange(offset) {
  const hoy = new Date(diaOperativo() + 'T12:00:00');
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
  const hoy  = diaOperativo();
  const ayer = sumarDias(hoy, -1);
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
  const [editando,           setEditando]           = useState(null);   // compra abierta en la hoja de edición
  const [avisoCompra,        setAvisoCompra]        = useState(null);
  const [semanaOffset,       setSemanaOffset]       = useState(0);
  const [loadingCompras,     setLoadingCompras]     = useState(false);
  const [metodoPago,         setMetodoPago]         = useState('efectivo');
  const [proveedorId,        setProveedorId]        = useState(null);
  const [proveedores,        setProveedores]        = useState([]);
  const [ultimaCompra,       setUltimaCompra]       = useState(null);
  const [desglose,           setDesglose]           = useState(null);

  // Cargar negocioId una sola vez
  useEffect(() => {
    supabase.from('productos').select('negocio_id').limit(1).single()
      .then(({ data }) => { if (data?.negocio_id) setNegocioId(data.negocio_id); });
    supabase.from('proveedores').select('id, nombre, dias_credito').eq('activo', true).order('nombre')
      .then(({ data }) => setProveedores(data || []));
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
      .select('*, compra_items(id)')
      .eq('negocio_id', nid)
      .eq('anulado', false)
      .gte('fecha', inicio)
      .lte('fecha', fin)
      .order('fecha',      { ascending: false })
      .order('created_at', { ascending: false });
    if (data) setCompras(data);
    setLoadingCompras(false);
  };

  const getFecha = () => {
    const hoy = diaOperativo();
    if (fechaOpt === 'hoy')  return hoy;
    if (fechaOpt === 'ayer') return sumarDias(hoy, -1);
    return fechaPersonalizada || hoy;
  };

  const proveedorSel = proveedores.find((p) => p.id === proveedorId);
  // Vencimiento lo calcula el trigger (fecha + días de crédito); aquí sólo se muestra
  const vencimiento  = metodoPago === 'credito' ? sumarDias(getFecha(), proveedorSel?.dias_credito || 0) : null;

  const canSave = descripcion.trim() && monto && (fechaOpt !== 'otra' || fechaPersonalizada);

  const guardar = async () => {
    if (!canSave || !negocioId) return;
    setGuardando(true);
    if (navigator.vibrate) navigator.vibrate(50);
    const { data: nueva, error } = await supabase.from('compras_insumos').insert({
      negocio_id:  negocioId,
      descripcion: descripcion.trim(),
      monto:       parseFloat(monto),
      categoria:   categoria || 'Otro',
      fecha:       getFecha(),
      metodo_pago: metodoPago,
      proveedor_id: proveedorId,
    }).select().single();
    if (!error) {
      setUltimaCompra(nueva);
      setDescripcion('');
      setMonto('');
      setCategoria('');
      setMetodoPago('efectivo');
      cargarCompras(negocioId, semanaOffset);
    } else {
      alert('Error al guardar: ' + error.message);
    }
    setGuardando(false);
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
  const hoyStr = diaOperativo();

  return (
    <div className="flex flex-col min-h-screen" style={{ background: 'var(--cream)' }}>
      <Header titulo="Compras de insumos" right={<MasMenu />} />

      <main className="flex-1 px-4 pt-4 pb-32 space-y-5">

        {/* ── DESCRIPCIÓN ── */}
        <div>
          <p className="text-xs font-bold tracking-wider mb-2" style={{ color: 'var(--orange-text)' }}>
            ¿QUÉ COMPRASTE?
          </p>
          <input
            type="text"
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder="Ej: Carne 5kg, Pan 30 piezas, Salsas..."
            className="w-full px-4 py-3 rounded-xl text-ink outline-none"
            style={{ background: 'var(--paper)', border: '1px solid var(--line)', fontSize: 16 }}
          />
        </div>

        {/* ── MONTO ── */}
        <div>
          <p className="text-xs font-bold tracking-wider mb-2" style={{ color: 'var(--ink-soft)' }}>
            ¿CUÁNTO PAGASTE?
          </p>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-lg" style={{ color: 'var(--ink-soft)' }}>$</span>
            <input
              type="number"
              inputMode="decimal"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              placeholder="0"
              className="w-full pl-10 pr-4 py-3 rounded-xl text-ink outline-none font-bold"
              style={{ background: 'var(--paper)', border: '1px solid var(--line)', fontSize: 20 }}
            />
          </div>
        </div>

        {/* ── CATEGORÍA ── */}
        <div>
          <p className="text-xs font-bold tracking-wider mb-2" style={{ color: 'var(--ink-soft)' }}>CATEGORÍA</p>
          <div className="flex flex-wrap gap-2">
            {CATEGORIAS.map((cat) => (
              <button
                key={cat}
                onClick={() => setCategoria(cat)}
                className="px-4 py-2 rounded-full font-medium text-sm"
                style={{
                  background: categoria === cat ? 'var(--orange-fill)' : 'var(--paper)',
                  color:      categoria === cat ? 'var(--on-orange)'    : 'var(--ink-soft)',
                  border:     `1px solid ${categoria === cat ? 'var(--orange-fill)' : 'var(--line)'}`,
                }}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* ── FORMA DE PAGO ── */}
        <div>
          <p className="text-xs font-bold tracking-wider mb-2" style={{ color: 'var(--ink-soft)' }}>¿CÓMO PAGASTE?</p>
          <div className="flex gap-2">
            {METODOS_COMPRA.map(({ key, label }) => (
              <button key={key} onClick={() => setMetodoPago(key)}
                className="flex-1 py-3 rounded-full font-bold text-sm"
                style={{
                  background: metodoPago === key ? 'var(--orange-fill)' : 'var(--paper)',
                  color:      metodoPago === key ? 'var(--on-orange)'    : 'var(--ink-soft)',
                  border:     `1px solid ${metodoPago === key ? 'var(--orange-fill)' : 'var(--line)'}`,
                }}>
                {label}
              </button>
            ))}
          </div>
          {metodoPago === 'credito' && (
            <p className="text-xs mt-2 px-1" style={{ color: 'var(--warn-ink)' }}>
              Se agenda en Gastos → Por pagar, vence el {formatDiaCorto(vencimiento)}
              {!proveedorSel && ' (elige proveedor para usar sus días de crédito)'}
            </p>
          )}
        </div>

        {/* ── PROVEEDOR ── */}
        {proveedores.length > 0 && (
          <div>
            <p className="text-xs font-bold tracking-wider mb-2" style={{ color: 'var(--ink-soft)' }}>PROVEEDOR (OPCIONAL)</p>
            <div className="flex flex-wrap gap-2">
              {proveedores.map((p) => (
                <button key={p.id} onClick={() => setProveedorId(proveedorId === p.id ? null : p.id)}
                  className="px-4 py-2 rounded-full font-medium text-sm"
                  style={{
                    background: proveedorId === p.id ? 'var(--orange-fill)' : 'var(--paper)',
                    color:      proveedorId === p.id ? 'var(--on-orange)'    : 'var(--ink-soft)',
                    border:     `1px solid ${proveedorId === p.id ? 'var(--orange-fill)' : 'var(--line)'}`,
                  }}>
                  {p.nombre}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── FECHA ── */}
        <div>
          <p className="text-xs font-bold tracking-wider mb-2" style={{ color: 'var(--ink-soft)' }}>FECHA</p>
          <div className="flex gap-2">
            {[
              { key: 'hoy',  label: 'Hoy'  },
              { key: 'ayer', label: 'Ayer' },
              { key: 'otra', label: '📅 Otra' },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setFechaOpt(key)}
                className="flex-1 py-3 rounded-full font-bold text-sm"
                style={{
                  background: fechaOpt === key ? 'var(--orange-fill)' : 'var(--paper)',
                  color:      fechaOpt === key ? 'var(--on-orange)'    : 'var(--ink-soft)',
                  border:     `1px solid ${fechaOpt === key ? 'var(--orange-fill)' : 'var(--line)'}`,
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
              className="mt-2 w-full px-4 py-3 rounded-xl text-ink outline-none"
              style={{
                background:  'var(--paper)',
                border:      '1px solid var(--orange)',
                fontSize:    16,
              }}
            />
          )}
        </div>

        {/* ── BOTÓN GUARDAR ── */}
        <button
          onClick={guardar}
          disabled={!canSave || guardando}
          className="btn-primary w-full py-3 rounded-full text-xl"
          style={{ minHeight: 56 }}
        >
          {guardando ? 'Guardando...' : 'GUARDAR COMPRA'}
        </button>

        {avisoCompra && (
          <button type="button" onClick={() => setAvisoCompra(null)} className="w-full text-left px-4 py-3 rounded-xl text-sm font-bold"
            style={{ background: 'var(--good-soft)', color: 'var(--good-ink)', border: '1px solid var(--line)' }}>{avisoCompra}</button>
        )}

        {/* ── DESGLOSE OPCIONAL DE LA ÚLTIMA COMPRA ── */}
        {ultimaCompra && (
          <div className="rounded-2xl p-3 space-y-2" style={{ background: 'var(--good-soft)', border: '1px solid var(--good-line)' }}>
            <p className="text-sm font-bold" style={{ color: 'var(--good-ink)' }}>
              ✓ Guardada: {ultimaCompra.descripcion} · {formatMXN(ultimaCompra.monto)}
            </p>
            <button onClick={() => { setDesglose(ultimaCompra); setUltimaCompra(null); }}
              className="w-full flex items-center justify-center gap-2 rounded-full font-bold"
              style={{ background: 'var(--orange-fill)', color: 'var(--on-orange)', minHeight: 52 }}>
              <Package size={18} /> Agregar insumos de esta compra
            </button>
            <p className="text-xs text-center" style={{ color: 'var(--ink-mute)' }}>
              Opcional: así entra al inventario y se actualiza el costo de tus recetas
            </p>
          </div>
        )}

        {/* ── DIVISOR ── */}
        <div style={{ borderTop: '1px solid var(--paper-2)', marginTop: 8 }} />

        {/* ── SELECTOR DE SEMANA ── */}
        <div
          className="flex items-center justify-between px-3 py-2 rounded-xl"
          style={{ background: 'var(--paper)', border: '1px solid var(--line)' }}
        >
          <button
            onClick={() => setSemanaOffset((o) => o - 1)}
            className="p-2 rounded-full"
            style={{ background: 'var(--paper-2)' }}
          >
            <ChevronLeft size={18} style={{ color: 'var(--ink-soft)' }} />
          </button>
          <div className="text-center">
            <p className="text-sm font-bold text-ink">{rango.label}</p>
            <p className="text-xs" style={{ color: semanaOffset === 0 ? 'var(--orange-text)' : 'var(--ink-mute)' }}>
              {semanaOffset === 0 ? 'Semana actual' : semanaOffset === -1 ? 'Semana pasada' : `Hace ${Math.abs(semanaOffset)} semanas`}
            </p>
          </div>
          <button
            onClick={() => setSemanaOffset((o) => Math.min(0, o + 1))}
            disabled={semanaOffset === 0}
            className="p-2 rounded-full"
            style={{ background: 'var(--paper-2)', opacity: semanaOffset === 0 ? 0.3 : 1 }}
          >
            <ChevronRight size={18} style={{ color: 'var(--ink-soft)' }} />
          </button>
        </div>

        {/* ── LISTA DE COMPRAS ── */}
        {loadingCompras ? (
          <div className="flex justify-center py-8">
            <div className="w-7 h-7 rounded-full border-2 animate-spin"
              style={{ borderColor: 'var(--orange)', borderTopColor: 'transparent' }} />
          </div>
        ) : compras.length === 0 ? (
          <div className="text-center py-8" style={{ color: 'var(--ink-mute)' }}>
            <p className="text-2xl mb-2">📦</p>
            <p className="text-sm">Sin compras esta semana</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Total de la semana */}
            <div className="flex items-center justify-between px-1">
              <p className="text-xs font-bold tracking-wider" style={{ color: 'var(--ink-soft)' }}>
                TOTAL SEMANA
              </p>
              <p className="font-bold text-ink text-lg">{formatMXN(totalSemana)}</p>
            </div>

            {/* Compras agrupadas por día */}
            {diasOrdenados.map((fecha) => {
              const items = comprasPorDia[fecha];
              const subtotal = items.reduce((s, c) => s + c.monto, 0);
              return (
                <div key={fecha}>
                  {/* Encabezado del día */}
                  <div className="flex items-center justify-between mb-2 px-1">
                    <p className="text-xs font-bold" style={{ color: 'var(--orange-text)' }}>
                      {formatDiaLabel(fecha).toUpperCase()}
                    </p>
                    <p className="text-xs font-bold" style={{ color: 'var(--ink-soft)' }}>
                      {formatMXN(subtotal)}
                    </p>
                  </div>

                  {/* Items del día */}
                  <div className="space-y-2">
                    {items.map((c) => (
                      <div key={c.id} className="rounded-xl overflow-hidden" style={{ background: 'var(--paper)', border: '1px solid var(--line)' }}>
                        <div className="flex items-center justify-between px-4 py-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-ink text-sm font-medium truncate">{c.descripcion}</p>
                            <p className="text-xs mt-0.5" style={{ color: c.metodo_pago === 'credito' ? 'var(--warn-ink)' : 'var(--ink-mute)' }}>
                              {c.categoria}{c.metodo_pago ? ` · ${c.metodo_pago === 'credito' ? 'a crédito' : c.metodo_pago}` : ''}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 ml-3">
                            <span className="font-bold text-ink">{formatMXN(c.monto)}</span>
                            <button
                              onClick={() => setDesglose(c)}
                              aria-label="Insumos de esta compra"
                              className="p-2 rounded-full flex items-center gap-1"
                              style={{ background: c.compra_items?.length ? 'var(--good-soft)' : 'var(--paper-2)' }}
                            >
                              <Package size={15} style={{ color: c.compra_items?.length ? 'var(--good-ink)' : 'var(--ink-mute)' }} />
                              {c.compra_items?.length > 0 && (
                                <span className="text-xs font-bold" style={{ color: 'var(--good-ink)' }}>{c.compra_items.length}</span>
                              )}
                            </button>
                            <button
                              onClick={() => setEditando(c)}
                              aria-label="Editar compra"
                              className="flex items-center justify-center rounded-full"
                              style={{ width: 44, height: 44, minHeight: 44, background: 'var(--paper)', border: '1px solid var(--line)' }}
                            >
                              <Pencil size={15} style={{ color: 'var(--ink-soft)' }} />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {editando && (
        <EditarCompra compra={editando} proveedores={proveedores}
          onClose={() => setEditando(null)}
          onDesglose={() => { setDesglose(editando); setEditando(null); }}
          onGuardado={(msg) => { setEditando(null); setAvisoCompra(msg); cargarCompras(negocioId, semanaOffset); }} />
      )}

      {desglose && (
        <DesgloseCompra compra={desglose} onClose={() => setDesglose(null)}
          onCambio={() => cargarCompras(negocioId, semanaOffset)} />
      )}

      <BottomNav />
    </div>
  );
}
