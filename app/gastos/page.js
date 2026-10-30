'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Plus, ShoppingBag } from 'lucide-react';
import BottomNav from '@/components/BottomNav';
import MasMenu from '@/components/MasMenu';
import { Header, Label, Chips, MontoInput, TextInput, BotonPrincipal, Sheet, Vacio, Cargando, CuentaChips, C } from '@/components/ui';
import { supabase } from '@/lib/supabase/client';
import { formatMXN } from '@/lib/calculos';
import { NEGOCIO_ID, CATEGORIAS_GASTO, FRECUENCIAS, DIAS_SEMANA_ISO, vibrar, msgError } from '@/lib/negocio';
import { diaOperativo, sumarDias, diasEntre, formatDiaCorto } from '@/lib/dia';

const TABS = [
  { key: 'pagar',       label: 'Por pagar' },
  { key: 'fijos',       label: 'Fijos' },
  { key: 'proveedores', label: 'Proveed.' },
];

const CAT_LABEL = Object.fromEntries([...CATEGORIAS_GASTO.map((c) => [c.key, c.label]),
  ['sueldo_dueno', 'Sueldo dueño'], ['insumos', 'Insumos']]);

const GASTO_VACIO = { id: null, concepto: '', monto: '', categoria: 'renta', frecuencia: 'mensual', dia_pago: 1, cuenta_pago_default: null };
const PROV_VACIO  = { id: null, nombre: '', telefono: '', dias_credito: '0' };

function chipVencimiento(fecha, hoy) {
  const d = diasEntre(hoy, fecha);
  if (d < 0)  return { texto: `Vencida ${-d}d`, color: C.bad };
  if (d === 0) return { texto: 'Hoy', color: C.bad };
  if (d <= 7) return { texto: `En ${d}d`, color: C.warn };
  return { texto: formatDiaCorto(fecha), color: C.dimmer };
}

function describirFrecuencia(g) {
  if (g.frecuencia === 'semanal') return `Cada ${DIAS_SEMANA_ISO.find((d) => d.key === g.dia_pago)?.label || ''}`;
  if (g.frecuencia === 'quincenal') return `Días ${g.dia_pago} y ${Math.min(g.dia_pago + 15, 31)}`;
  // Convención: dia_pago = 31 = último día del mes (30 nov, 28/29 feb…)
  return `${g.frecuencia === 'bimestral' ? 'Cada 2 meses' : 'Cada mes'}, ${g.dia_pago >= 31 ? 'último día' : `día ${g.dia_pago}`}`;
}

export default function GastosPage() {
  const hoy = diaOperativo();
  const [tab,          setTab]          = useState('pagar');
  const [cargando,     setCargando]     = useState(true);
  const [obligaciones, setObligaciones] = useState([]);
  const [fijos,        setFijos]        = useState([]);
  const [proveedores,  setProveedores]  = useState([]);
  const [cuentas,      setCuentas]      = useState([]);
  const [ver90,        setVer90]        = useState(false);
  const [aviso,        setAviso]        = useState(null);
  const [guardando,    setGuardando]    = useState(false);

  // Hojas
  const [pagando,   setPagando]   = useState(null);  // obligación
  const [pagoMonto, setPagoMonto] = useState('');
  const [pagoCuenta, setPagoCuenta] = useState(null);
  const [gasto,     setGasto]     = useState(null);  // gasto recurrente en edición
  const [prov,      setProv]      = useState(null);  // proveedor en edición
  const [suelto,    setSuelto]    = useState(null);  // gasto suelto

  const cargar = useCallback(async () => {
    // Genera las obligaciones de los próximos 90 días (idempotente)
    const { error: genErr } = await supabase.rpc('generar_obligaciones', { p_negocio: NEGOCIO_ID, p_hasta: sumarDias(diaOperativo(), 90) });
    if (genErr) setAviso({ texto: 'Error al generar pagos: ' + genErr.message, color: C.bad });
    const [o, g, p, cs] = await Promise.all([
      supabase.from('obligaciones').select('*, proveedores(nombre)').eq('negocio_id', NEGOCIO_ID)
        .in('estado', ['pendiente', 'parcial']).order('fecha_vencimiento'),
      supabase.from('gastos_recurrentes').select('*').eq('negocio_id', NEGOCIO_ID).eq('activo', true).order('created_at'),
      supabase.from('proveedores').select('*').eq('negocio_id', NEGOCIO_ID).eq('activo', true).order('nombre'),
      supabase.from('v_saldos_cuentas').select('*').eq('negocio_id', NEGOCIO_ID).eq('activa', true).order('orden'),
    ]);
    setObligaciones(o.data || []);
    setFijos(g.data || []);
    setProveedores(p.data || []);
    setCuentas(cs.data || []);
    setCargando(false);
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const cuentaId = (clave) => cuentas.find((c) => c.clave === clave)?.cuenta_id;
  const ok = (texto) => { vibrar(); setAviso({ texto, color: C.ok }); setGuardando(false); cargar(); };
  const fallo = (err) => { setGuardando(false); alert('No se pudo guardar: ' + msgError(err)); };

  // ── Pagar obligación ─────────────────────────────────────────
  const abrirPago = (o) => {
    const fijo = fijos.find((g) => g.id === o.gasto_recurrente_id);
    setPagoMonto(String(Number(o.monto) - Number(o.monto_pagado)));
    setPagoCuenta(fijo?.cuenta_pago_default || cuentaId('banco'));
    setPagando(o);
  };
  const pagar = async () => {
    const m = parseFloat(pagoMonto);
    if (!(m > 0) || !pagoCuenta) return;
    setGuardando(true);
    const { data, error } = await supabase.rpc('pagar_obligacion', { p_obligacion: pagando.id, p_cuenta: pagoCuenta, p_monto: m });
    if (error) return fallo(error);
    setPagando(null);
    ok(data?.estado === 'pagada' ? `Pagado: ${pagando.concepto}` : `Abonaste ${formatMXN(m)}, quedan ${formatMXN(data?.pendiente)}`);
  };
  const cancelarObligacion = async () => {
    if (!confirm(`¿Cancelar "${pagando.concepto}"? No se mueve dinero.`)) return;
    const { error } = await supabase.from('obligaciones').update({ estado: 'cancelada' }).eq('id', pagando.id);
    if (error) return fallo(error);
    setPagando(null);
    ok('Pago cancelado');
  };

  // ── Gastos fijos ─────────────────────────────────────────────
  const guardarGasto = async () => {
    const m = parseFloat(gasto.monto);
    if (!gasto.concepto.trim() || !(m > 0)) return;
    setGuardando(true);
    const fila = {
      concepto: gasto.concepto.trim(), monto: m, categoria: gasto.categoria, frecuencia: gasto.frecuencia,
      dia_pago: Math.min(Math.max(parseInt(gasto.dia_pago, 10) || 1, 1), gasto.frecuencia === 'quincenal' ? 15 : 31),
      cuenta_pago_default: gasto.cuenta_pago_default,
    };
    const { error } = gasto.id
      ? await supabase.from('gastos_recurrentes').update(fila).eq('id', gasto.id)
      : await supabase.from('gastos_recurrentes').insert({ ...fila, negocio_id: NEGOCIO_ID });
    if (error) return fallo(error);
    setGasto(null);
    ok(gasto.id ? 'Gasto fijo actualizado' : 'Gasto fijo agregado');
  };
  const desactivarGasto = async () => {
    if (!confirm(`¿Quitar "${gasto.concepto}"? Se cancelan sus pagos pendientes.`)) return;
    const { error } = await supabase.from('gastos_recurrentes').update({ activo: false }).eq('id', gasto.id);
    if (error) return fallo(error);
    setGasto(null);
    ok('Gasto fijo eliminado');
  };

  // ── Proveedores ──────────────────────────────────────────────
  const guardarProv = async () => {
    if (!prov.nombre.trim()) return;
    setGuardando(true);
    const fila = { nombre: prov.nombre.trim(), telefono: prov.telefono.trim() || null, dias_credito: parseInt(prov.dias_credito, 10) || 0 };
    const { error } = prov.id
      ? await supabase.from('proveedores').update(fila).eq('id', prov.id)
      : await supabase.from('proveedores').insert({ ...fila, negocio_id: NEGOCIO_ID });
    if (error) return fallo(error);
    setProv(null);
    ok('Proveedor guardado');
  };
  const borrarProv = async () => {
    if (!confirm(`¿Quitar a ${prov.nombre}?`)) return;
    const { error } = await supabase.from('proveedores').update({ activo: false }).eq('id', prov.id);
    if (error) return fallo(error);
    setProv(null);
    ok('Proveedor eliminado');
  };

  // ── Gasto suelto: crea obligación y opcionalmente la paga ────
  const abrirSuelto = () => setSuelto({ concepto: '', monto: '', categoria: 'otro', pagado: true, cuenta: cuentaId('caja'), vence: hoy });
  const guardarSuelto = async () => {
    const m = parseFloat(suelto.monto);
    if (!suelto.concepto.trim() || !(m > 0)) return;
    setGuardando(true);
    const { data: ob, error } = await supabase.from('obligaciones').insert({
      negocio_id: NEGOCIO_ID, concepto: suelto.concepto.trim(), categoria: suelto.categoria, monto: m,
      fecha_vencimiento: suelto.pagado ? hoy : suelto.vence, origen: 'manual',
    }).select().single();
    if (error) return fallo(error);
    if (suelto.pagado) {
      const { error: e2 } = await supabase.rpc('pagar_obligacion', { p_obligacion: ob.id, p_cuenta: suelto.cuenta, p_monto: m });
      if (e2) return fallo(e2);
    }
    setSuelto(null);
    ok(suelto.pagado ? `Gasto de ${formatMXN(m)} pagado` : `Gasto por pagar agregado`);
  };

  const limite = sumarDias(hoy, ver90 ? 90 : 30);
  const visibles = obligaciones.filter((o) => o.fecha_vencimiento <= limite);
  const pendiente = (o) => Number(o.monto) - Number(o.monto_pagado);
  const totalVencido = obligaciones.filter((o) => o.fecha_vencimiento < hoy).reduce((s, o) => s + pendiente(o), 0);
  const total7  = obligaciones.filter((o) => o.fecha_vencimiento <= sumarDias(hoy, 7)).reduce((s, o) => s + pendiente(o), 0);
  const total30 = obligaciones.filter((o) => o.fecha_vencimiento <= sumarDias(hoy, 30)).reduce((s, o) => s + pendiente(o), 0);

  return (
    <div className="flex flex-col min-h-screen" style={{ background: C.bg }}>
      <Header right={
        <div className="flex items-center gap-2">
          <button type="button" onClick={abrirSuelto}
            className="flex items-center gap-1.5 px-4 rounded-xl font-bold text-sm"
            style={{ background: C.brand, color: '#fff' }}>
            <Plus size={18} strokeWidth={2.5} />Gasto
          </button>
          <MasMenu />
        </div>
      } />

      <main className="flex-1 px-4 pt-4 pb-32 space-y-4">
        {aviso && (
          <button type="button" onClick={() => setAviso(null)} className="w-full text-left px-4 py-3 rounded-xl text-sm font-bold"
            style={{ background: `${aviso.color}18`, color: aviso.color, border: `1px solid ${aviso.color}44` }}>
            {aviso.texto}
          </button>
        )}

        <Chips options={TABS} value={tab} onChange={setTab} />

        {cargando ? <Cargando /> : tab === 'pagar' ? (
          <>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Vencido',   value: totalVencido, color: totalVencido > 0 ? C.bad : '#fff' },
                { label: '7 días',    value: total7,       color: C.warn },
                { label: '30 días',   value: total30,      color: '#fff' },
              ].map(({ label, value, color }) => (
                <div key={label} className="rounded-xl p-3 text-center" style={{ background: C.surface }}>
                  <p className="text-base font-bold" style={{ color }}>{formatMXN(value)}</p>
                  <p className="text-xs" style={{ color: C.dimmer }}>{label}</p>
                </div>
              ))}
            </div>

            {obligaciones.length === 0 ? (
              <Vacio emoji="🧾" titulo="Nada por pagar"
                texto="Agrega tus gastos fijos (renta, luz, nómina…) para ver qué se viene."
                accion="Agrega tu primer gasto fijo" onAccion={() => { setTab('fijos'); setGasto({ ...GASTO_VACIO }); }} />
            ) : (
              <div className="space-y-2">
                {visibles.map((o) => {
                  const chip = chipVencimiento(o.fecha_vencimiento, hoy);
                  return (
                    <div key={o.id} className="flex items-center gap-3 px-4 py-3 rounded-xl" style={{ background: C.surface }}>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-white truncate">{o.concepto}</p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: `${chip.color}22`, color: chip.color }}>
                            {chip.texto}
                          </span>
                          <span className="text-xs" style={{ color: C.dimmer }}>
                            {o.proveedores?.nombre || CAT_LABEL[o.categoria] || o.categoria}
                            {o.estado === 'parcial' && ` · abonado ${formatMXN(o.monto_pagado)}`}
                          </span>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-white">{formatMXN(pendiente(o))}</p>
                      </div>
                      <button type="button" onClick={() => abrirPago(o)} className="px-4 rounded-xl font-bold text-sm"
                        style={{ background: C.brand, color: '#fff' }}>Pagar</button>
                    </div>
                  );
                })}
                {obligaciones.length > visibles.length && (
                  <button type="button" onClick={() => setVer90(true)} className="w-full rounded-xl text-sm font-bold"
                    style={{ background: C.surface2, color: C.dim }}>
                    Ver los próximos 90 días ({obligaciones.length - visibles.length} más)
                  </button>
                )}
              </div>
            )}
          </>
        ) : tab === 'fijos' ? (
          <>
            {fijos.length === 0 ? (
              <Vacio emoji="📅" titulo="Sin gastos fijos"
                texto="Renta, luz, agua, gas, internet, nómina, software… lo que pagas cada cierto tiempo."
                accion="Agrega tu primer gasto fijo" onAccion={() => setGasto({ ...GASTO_VACIO })} />
            ) : (
              <div className="space-y-2">
                {fijos.map((g) => (
                  <button key={g.id} type="button"
                    onClick={() => g.categoria !== 'sueldo_dueno' && setGasto({ ...g, monto: String(g.monto) })}
                    className="w-full flex items-center justify-between px-4 py-3 rounded-xl text-left" style={{ background: C.surface }}>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-white truncate">{g.concepto}</p>
                      <p className="text-xs" style={{ color: C.dimmer }}>
                        {CAT_LABEL[g.categoria]} · {describirFrecuencia(g)}
                        {g.categoria === 'sueldo_dueno' && ' · se edita en Configuración'}
                      </p>
                    </div>
                    <span className="font-bold text-white ml-3">{formatMXN(g.monto)}</span>
                  </button>
                ))}
                <BotonPrincipal onClick={() => setGasto({ ...GASTO_VACIO })}>+ AGREGAR GASTO FIJO</BotonPrincipal>
              </div>
            )}
          </>
        ) : (
          <>
            {proveedores.length === 0 ? (
              <Vacio emoji="🚚" titulo="Sin proveedores"
                texto="Agrega a quien te surte (carne, pan…) y cuántos días de crédito te da."
                accion="Agregar proveedor" onAccion={() => setProv({ ...PROV_VACIO })} />
            ) : (
              <div className="space-y-2">
                {proveedores.map((p) => (
                  <button key={p.id} type="button" onClick={() => setProv({ ...p, telefono: p.telefono || '', dias_credito: String(p.dias_credito) })}
                    className="w-full flex items-center justify-between px-4 py-3 rounded-xl text-left" style={{ background: C.surface }}>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-white truncate">{p.nombre}</p>
                      <p className="text-xs" style={{ color: C.dimmer }}>{p.telefono || 'Sin teléfono'}</p>
                    </div>
                    <span className="text-xs font-bold ml-3" style={{ color: p.dias_credito > 0 ? C.warn : C.dimmer }}>
                      {p.dias_credito > 0 ? `${p.dias_credito} días crédito` : 'Contado'}
                    </span>
                  </button>
                ))}
                <BotonPrincipal onClick={() => setProv({ ...PROV_VACIO })}>+ AGREGAR PROVEEDOR</BotonPrincipal>
              </div>
            )}
          </>
        )}

        <Link href="/insumos" className="flex items-center justify-center gap-2 rounded-2xl font-bold text-sm"
          style={{ background: C.surface2, color: C.dim, minHeight: 48 }}>
          <ShoppingBag size={16} /> Registrar compra de insumos
        </Link>
      </main>

      {/* ── Hoja: pagar ── */}
      <Sheet open={!!pagando} title={`Pagar · ${pagando?.concepto || ''}`} onClose={() => setPagando(null)}>
        {pagando && (
          <>
            <div>
              <Label color={C.brand}>¿CUÁNTO PAGAS?</Label>
              <MontoInput value={pagoMonto} onChange={setPagoMonto} />
              <p className="text-xs mt-1" style={{ color: C.dimmer }}>Pendiente: {formatMXN(pendiente(pagando))} · puedes abonar menos</p>
            </div>
            <div>
              <Label>¿DE QUÉ CUENTA?</Label>
              <CuentaChips cuentas={cuentas} value={pagoCuenta} onChange={setPagoCuenta} excluir={['didi']} />
            </div>
            <BotonPrincipal onClick={pagar} disabled={guardando || !(parseFloat(pagoMonto) > 0) || !pagoCuenta}>
              {guardando ? 'Guardando...' : 'PAGAR'}
            </BotonPrincipal>
            {pagando.origen !== 'compra_credito' && Number(pagando.monto_pagado) === 0 && (
              <button type="button" onClick={cancelarObligacion} className="w-full rounded-xl text-sm font-bold"
                style={{ background: '#ef444411', color: C.bad }}>No se va a pagar (cancelar)</button>
            )}
          </>
        )}
      </Sheet>

      {/* ── Hoja: gasto fijo ── */}
      <Sheet open={!!gasto} title={gasto?.id ? 'Editar gasto fijo' : 'Nuevo gasto fijo'} onClose={() => setGasto(null)}>
        {gasto && (
          <>
            <TextInput value={gasto.concepto} onChange={(v) => setGasto({ ...gasto, concepto: v })} placeholder="Ej: Renta del local" />
            <MontoInput value={gasto.monto} onChange={(v) => setGasto({ ...gasto, monto: v })} />
            <div>
              <Label>CATEGORÍA</Label>
              <Chips options={CATEGORIAS_GASTO} value={gasto.categoria} onChange={(v) => setGasto({ ...gasto, categoria: v })} wrap />
            </div>
            <div>
              <Label>¿CADA CUÁNDO?</Label>
              <Chips options={FRECUENCIAS} value={gasto.frecuencia} wrap
                onChange={(v) => setGasto({ ...gasto, frecuencia: v, dia_pago: v === 'semanal' ? 1 : (gasto.frecuencia === 'semanal' ? 1 : gasto.dia_pago) })} />
            </div>
            <div>
              <Label>{gasto.frecuencia === 'semanal' ? 'DÍA DE PAGO' : gasto.frecuencia === 'quincenal' ? 'DÍA DEL PRIMER PAGO (el 2º es +15)' : 'DÍA DEL MES'}</Label>
              {gasto.frecuencia === 'semanal' ? (
                <Chips options={DIAS_SEMANA_ISO} value={gasto.dia_pago} onChange={(v) => setGasto({ ...gasto, dia_pago: v })} />
              ) : gasto.frecuencia === 'quincenal' ? (
                <TextInput value={String(gasto.dia_pago)} inputMode="numeric" type="number"
                  onChange={(v) => setGasto({ ...gasto, dia_pago: v })} placeholder="1–15" />
              ) : (
                <div className="space-y-2">
                  <Chips options={[{ key: 'dia', label: 'Un día fijo' }, { key: 'ultimo', label: 'Último día del mes' }]}
                    value={Number(gasto.dia_pago) >= 31 ? 'ultimo' : 'dia'}
                    onChange={(k) => setGasto({ ...gasto, dia_pago: k === 'ultimo' ? 31 : 1 })} />
                  {Number(gasto.dia_pago) < 31 && (
                    <TextInput value={String(gasto.dia_pago)} inputMode="numeric" type="number"
                      onChange={(v) => setGasto({ ...gasto, dia_pago: v })} placeholder="1–30" />
                  )}
                </div>
              )}
            </div>
            <div>
              <Label>SE PAGA DE (OPCIONAL)</Label>
              <CuentaChips cuentas={cuentas} value={gasto.cuenta_pago_default} excluir={['didi']}
                onChange={(v) => setGasto({ ...gasto, cuenta_pago_default: gasto.cuenta_pago_default === v ? null : v })} />
            </div>
            <BotonPrincipal onClick={guardarGasto} disabled={guardando || !gasto.concepto.trim() || !(parseFloat(gasto.monto) > 0)}>
              {guardando ? 'Guardando...' : 'GUARDAR'}
            </BotonPrincipal>
            {gasto.id && (
              <button type="button" onClick={desactivarGasto} className="w-full rounded-xl text-sm font-bold"
                style={{ background: '#ef444411', color: C.bad }}>Quitar este gasto fijo</button>
            )}
          </>
        )}
      </Sheet>

      {/* ── Hoja: proveedor ── */}
      <Sheet open={!!prov} title={prov?.id ? 'Editar proveedor' : 'Nuevo proveedor'} onClose={() => setProv(null)}>
        {prov && (
          <>
            <TextInput value={prov.nombre} onChange={(v) => setProv({ ...prov, nombre: v })} placeholder="Nombre" />
            <TextInput value={prov.telefono} onChange={(v) => setProv({ ...prov, telefono: v })} placeholder="Teléfono (opcional)" type="tel" inputMode="tel" />
            <div>
              <Label>DÍAS DE CRÉDITO</Label>
              <Chips options={[{ key: '0', label: 'Contado' }, { key: '7', label: '7' }, { key: '15', label: '15' }, { key: '30', label: '30' }]}
                value={String(prov.dias_credito)} onChange={(v) => setProv({ ...prov, dias_credito: v })} />
            </div>
            <BotonPrincipal onClick={guardarProv} disabled={guardando || !prov.nombre.trim()}>
              {guardando ? 'Guardando...' : 'GUARDAR'}
            </BotonPrincipal>
            {prov.id && (
              <button type="button" onClick={borrarProv} className="w-full rounded-xl text-sm font-bold"
                style={{ background: '#ef444411', color: C.bad }}>Quitar proveedor</button>
            )}
          </>
        )}
      </Sheet>

      {/* ── Hoja: gasto suelto ── */}
      <Sheet open={!!suelto} title="Gasto suelto" onClose={() => setSuelto(null)}>
        {suelto && (
          <>
            <TextInput value={suelto.concepto} onChange={(v) => setSuelto({ ...suelto, concepto: v })} placeholder="¿Qué pagaste? Ej: plomero" />
            <MontoInput value={suelto.monto} onChange={(v) => setSuelto({ ...suelto, monto: v })} />
            <div>
              <Label>CATEGORÍA</Label>
              <Chips options={CATEGORIAS_GASTO} value={suelto.categoria} onChange={(v) => setSuelto({ ...suelto, categoria: v })} wrap />
            </div>
            <Chips options={[{ key: true, label: 'Ya lo pagué' }, { key: false, label: 'Lo debo' }]}
              value={suelto.pagado} onChange={(v) => setSuelto({ ...suelto, pagado: v })} />
            {suelto.pagado ? (
              <div>
                <Label>¿DE QUÉ CUENTA?</Label>
                <CuentaChips cuentas={cuentas} value={suelto.cuenta} onChange={(v) => setSuelto({ ...suelto, cuenta: v })} excluir={['didi']} />
              </div>
            ) : (
              <div>
                <Label>¿CUÁNDO VENCE?</Label>
                <TextInput type="date" value={suelto.vence} onChange={(v) => setSuelto({ ...suelto, vence: v })} />
              </div>
            )}
            <BotonPrincipal onClick={guardarSuelto}
              disabled={guardando || !suelto.concepto.trim() || !(parseFloat(suelto.monto) > 0) || (suelto.pagado && !suelto.cuenta)}>
              {guardando ? 'Guardando...' : 'GUARDAR'}
            </BotonPrincipal>
          </>
        )}
      </Sheet>

      <BottomNav />
    </div>
  );
}
