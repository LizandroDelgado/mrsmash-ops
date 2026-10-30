'use client';
// Por pagar: editar la obligación, pagarla, y editar o deshacer cada pago (abono).
// Todo pasa por RPC: los pagos revierten y re-publican en Caja; cancelar deshace los pagos primero.
import { useCallback, useEffect, useState } from 'react';
import AccionesEdicion from '@/components/AccionesEdicion';
import { Sheet, Label, Chips, MontoInput, TextInput, CuentaChips, BotonPrincipal, BotonSecundario, Cargando, C } from '@/components/ui';
import { supabase } from '@/lib/supabase/client';
import { formatMXN } from '@/lib/calculos';
import { formatDiaCorto, diaOperativo } from '@/lib/dia';
import { CATEGORIAS_GASTO, vibrar, msgError } from '@/lib/negocio';

const n = (x) => Number(x) || 0;

export default function ObligacionSheet({ obligacionId, cuentas, proveedores, fijos, onClose, onCambio }) {
  const [o,         setO]         = useState(null);
  const [pagos,     setPagos]     = useState([]);
  const [form,      setForm]      = useState(null);
  const [alcance,   setAlcance]   = useState('solo');
  const [pagoMonto, setPagoMonto] = useState('');
  const [pagoCuenta, setPagoCuenta] = useState(null);
  const [pagoSel,   setPagoSel]   = useState(null);   // { id, monto, cuenta_id, fecha }
  const [guardando, setGuardando] = useState(false);

  const cuentaId = (clave) => cuentas.find((c) => c.clave === clave)?.cuenta_id;
  const cargar = useCallback(async () => {
    const [{ data: ob }, { data: ps }] = await Promise.all([
      supabase.from('obligaciones').select('*, proveedores(nombre)').eq('id', obligacionId).single(),
      supabase.from('pagos_obligacion').select('id, monto, fecha, movimiento_id, movimientos(cuenta_id)').eq('obligacion_id', obligacionId).eq('anulado', false).order('fecha'),
    ]);
    setO(ob);
    setPagos(ps || []);
    setForm({ concepto: ob.concepto, monto: String(n(ob.monto)), fecha_vencimiento: ob.fecha_vencimiento, categoria: ob.categoria, proveedor_id: ob.proveedor_id, notas: ob.notas || '' });
    const fijo = fijos.find((g) => g.id === ob.gasto_recurrente_id);
    setPagoMonto(String(n(ob.monto) - n(ob.monto_pagado)));
    setPagoCuenta(fijo?.cuenta_pago_default || cuentaId('banco'));
  }, [obligacionId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { cargar(); }, [cargar]);

  const correr = async (fn, okMsg, cerrar = false) => {
    setGuardando(true);
    const { error } = await fn();
    setGuardando(false);
    if (error) { alert('No se guardó: ' + msgError(error)); return false; }
    vibrar();
    onCambio(okMsg);
    if (cerrar) onClose(); else await cargar();
    return true;
  };

  if (!o || !form) return <Sheet open title="Por pagar" onClose={onClose}><Cargando /></Sheet>;
  const pendiente = n(o.monto) - n(o.monto_pagado);
  const cancelada = o.estado === 'cancelada';
  const deFijo = !!o.gasto_recurrente_id;

  return (
    <Sheet open title={o.concepto} onClose={onClose}>
      <div className="grid grid-cols-3 gap-2 text-center">
        {[['Monto', o.monto], ['Pagado', o.monto_pagado], ['Falta', pendiente]].map(([l, v]) => (
          <div key={l} className="rounded-xl p-2" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
            <p className="text-xs" style={{ color: C.dim }}>{l}</p>
            <p className="font-display text-lg" style={{ color: C.ink, fontWeight: 600 }}>{formatMXN(v)}</p>
          </div>
        ))}
      </div>

      {/* Pagar / abonar */}
      {!cancelada && pendiente > 0.005 && (
        <section className="rounded-card p-3 space-y-3" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
          <Label className="mb-0">PAGAR</Label>
          <MontoInput value={pagoMonto} onChange={setPagoMonto} />
          <CuentaChips cuentas={cuentas} value={pagoCuenta} onChange={setPagoCuenta} excluir={['didi']} />
          <BotonPrincipal disabled={guardando || !(parseFloat(pagoMonto) > 0) || !pagoCuenta}
            onClick={() => correr(() => supabase.rpc('pagar_obligacion', { p_obligacion: o.id, p_cuenta: pagoCuenta, p_monto: parseFloat(pagoMonto) }),
              parseFloat(pagoMonto) >= pendiente - 0.005 ? `Pagado: ${o.concepto}` : `Abonaste ${formatMXN(parseFloat(pagoMonto))}`)}>
            {guardando ? 'Guardando…' : 'Pagar'}
          </BotonPrincipal>
        </section>
      )}

      {/* Pagos hechos: editar o deshacer cada uno */}
      {pagos.length > 0 && (
        <section className="space-y-2">
          <Label>PAGOS HECHOS</Label>
          {pagos.map((pg) => (pagoSel?.id === pg.id ? (
            <div key={pg.id} className="rounded-card p-3 space-y-3" style={{ background: C.surface, border: `1px solid ${C.brandLine}` }}>
              <MontoInput value={pagoSel.monto} onChange={(v) => setPagoSel({ ...pagoSel, monto: v })} />
              <CuentaChips cuentas={cuentas} value={pagoSel.cuenta_id} onChange={(v) => setPagoSel({ ...pagoSel, cuenta_id: v })} excluir={['didi']} />
              <TextInput type="date" value={pagoSel.fecha} onChange={(v) => setPagoSel({ ...pagoSel, fecha: v })} />
              <AccionesEdicion guardando={guardando} puedeGuardar={parseFloat(pagoSel.monto) > 0}
                onGuardar={async () => { if (await correr(() => supabase.rpc('editar_pago', { p_pago: pg.id, p_monto: parseFloat(pagoSel.monto), p_cuenta: pagoSel.cuenta_id, p_fecha: pagoSel.fecha }), 'Pago corregido')) setPagoSel(null); }}
                onEliminar={async () => { if (await correr(() => supabase.rpc('anular_pago', { p_pago: pg.id }), 'Pago deshecho: el dinero regresó a la cuenta')) setPagoSel(null); }}
                textoEliminar="Deshacer pago" onCancelar={() => setPagoSel(null)}
                avisoEliminar="El dinero regresa a la cuenta y la obligación vuelve a estar pendiente." />
            </div>
          ) : (
            <button key={pg.id} type="button"
              onClick={() => setPagoSel({ id: pg.id, monto: String(n(pg.monto)), cuenta_id: pg.movimientos?.cuenta_id, fecha: diaOperativo(new Date(pg.fecha)) })}
              className="w-full flex items-center justify-between px-4 rounded-xl text-left" style={{ background: C.surface, border: `1px solid ${C.border}`, minHeight: 52 }}>
              <span className="text-sm" style={{ color: C.dim }}>
                {formatDiaCorto(diaOperativo(new Date(pg.fecha)))} · {cuentas.find((c) => c.cuenta_id === pg.movimientos?.cuenta_id)?.nombre || ''}
              </span>
              <span className="font-bold text-ink">{formatMXN(pg.monto)}</span>
            </button>
          )))}
          {o.estado === 'pagada' && (
            <BotonSecundario peligro disabled={guardando}
              onClick={async () => { for (const pg of pagos) { const { error } = await supabase.rpc('anular_pago', { p_pago: pg.id }); if (error) { alert(msgError(error)); break; } } vibrar(); onCambio('Marcada como no pagada'); await cargar(); }}>
              Marcar como no pagada
            </BotonSecundario>
          )}
        </section>
      )}

      {/* Datos de la obligación */}
      {!cancelada && (
        <section className="space-y-3">
          <Label>DATOS</Label>
          <TextInput value={form.concepto} onChange={(v) => setForm({ ...form, concepto: v })} placeholder="Concepto" />
          <MontoInput value={form.monto} onChange={(v) => setForm({ ...form, monto: v })} />
          <div><Label>VENCE</Label><TextInput type="date" value={form.fecha_vencimiento} onChange={(v) => setForm({ ...form, fecha_vencimiento: v })} /></div>
          <div><Label>CATEGORÍA</Label><Chips options={CATEGORIAS_GASTO} value={form.categoria} onChange={(v) => setForm({ ...form, categoria: v })} wrap /></div>
          {proveedores.length > 0 && (
            <div><Label>PROVEEDOR</Label>
              <Chips options={[{ key: null, label: 'Ninguno' }, ...proveedores.map((p) => ({ key: p.id, label: p.nombre }))]}
                value={form.proveedor_id} onChange={(v) => setForm({ ...form, proveedor_id: v })} wrap /></div>
          )}
          <TextInput value={form.notas} onChange={(v) => setForm({ ...form, notas: v })} placeholder="Notas (opcional)" />
          {deFijo && (
            <div>
              <Label>¿SOLO ESTE MES O TAMBIÉN LOS SIGUIENTES?</Label>
              <Chips options={[{ key: 'solo', label: 'Solo este' }, { key: 'siguientes', label: 'Y los siguientes' }]} value={alcance} onChange={setAlcance} />
              {alcance === 'siguientes' && <p className="text-xs mt-1" style={{ color: C.dimmer }}>Cambia el gasto fijo y los pagos futuros que aún no hayas hecho.</p>}
            </div>
          )}
          <AccionesEdicion guardando={guardando}
            puedeGuardar={!!form.concepto.trim() && parseFloat(form.monto) > 0 && !!form.fecha_vencimiento}
            onGuardar={() => correr(() => supabase.rpc('editar_obligacion', { p_obligacion: o.id, p_alcance: alcance, p: {
              concepto: form.concepto, monto: parseFloat(form.monto), fecha_vencimiento: form.fecha_vencimiento,
              categoria: form.categoria, proveedor_id: form.proveedor_id || '', notas: form.notas,
            } }), alcance === 'siguientes' ? 'Actualizado este y los siguientes' : 'Pago por hacer actualizado', true)}
            onEliminar={() => correr(() => supabase.rpc('cancelar_obligacion', { p_obligacion: o.id }), 'Eliminado de Por pagar', true)}
            onCancelar={onClose}
            avisoEliminar={pagos.length ? 'Primero se deshacen sus pagos (el dinero regresa a la cuenta).' : deFijo ? 'Solo este periodo; el gasto fijo sigue para los demás.' : undefined} />
        </section>
      )}
      {cancelada && <p className="text-sm" style={{ color: C.dim }}>Esta obligación está cancelada.</p>}
    </Sheet>
  );
}
