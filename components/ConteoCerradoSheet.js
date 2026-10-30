'use client';
// Conteo cerrado: corregir lo contado de un insumo (recalcula su ajuste) o anular el conteo completo
// (revierte todos sus ajustes; el inventario queda como antes del conteo).
import { useCallback, useEffect, useState } from 'react';
import AccionesEdicion from '@/components/AccionesEdicion';
import { Sheet, Label, CantidadInput, Cargando, C } from '@/components/ui';
import { supabase } from '@/lib/supabase/client';
import { formatMXN } from '@/lib/calculos';
import { formatFechaHora } from '@/lib/dia';
import { vibrar, msgError } from '@/lib/negocio';
import { UNIDAD_GRANDE, fmtCantidad, aGrande, deGrande } from '@/lib/inventario';

export default function ConteoCerradoSheet({ conteo, onClose, onCambio }) {
  const [items,     setItems]     = useState(null);
  const [sel,       setSel]       = useState(null);   // { id, valor (unidad grande), unidad }
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    const { data } = await supabase.from('conteo_items')
      .select('id, cantidad_fisica, cantidad_teorica, diferencia, valor_diferencia, insumos(nombre, unidad_base)')
      .eq('conteo_id', conteo.id).order('created_at');
    setItems(data || []);
  }, [conteo.id]);
  useEffect(() => { cargar(); }, [cargar]);

  const correr = async (fn, msg, cerrar) => {
    setGuardando(true);
    const { error } = await fn();
    setGuardando(false);
    if (error) { alert(msgError(error)); return; }
    vibrar();
    onCambio(msg);
    setSel(null);
    if (cerrar) onClose(); else cargar();
  };

  const total = (items || []).reduce((s, i) => s + Number(i.valor_diferencia || 0), 0);
  return (
    <Sheet open title={`Conteo · ${formatFechaHora(conteo.fecha)}`} onClose={onClose}>
      {!items ? <Cargando /> : (
        <>
          <p className="text-sm" style={{ color: C.dim }}>
            Diferencia valorizada: <b style={{ color: total < 0 ? C.bad : total > 0 ? C.ok : C.ink }}>{formatMXN(total)}</b>. Toca un insumo para corregir lo que contaste.
          </p>
          <div className="space-y-2">
            {items.map((i) => {
              const u = i.insumos?.unidad_base || 'pza';
              if (sel?.id === i.id) {
                return (
                  <div key={i.id} className="rounded-card p-3 space-y-3" style={{ background: C.surface, border: `1px solid ${C.brandLine}` }}>
                    <Label className="mb-0">{i.insumos?.nombre} · ¿CUÁNTO HABÍA?</Label>
                    <CantidadInput value={sel.valor} onChange={(v) => setSel({ ...sel, valor: v })} unidad={UNIDAD_GRANDE[u].label} />
                    <AccionesEdicion guardando={guardando} puedeGuardar={sel.valor !== '' && Number(sel.valor) >= 0}
                      onGuardar={() => correr(() => supabase.rpc('editar_conteo_item', { p_item: i.id, p_fisica: deGrande(sel.valor, u) }), 'Conteo corregido')}
                      onCancelar={() => setSel(null)} />
                  </div>
                );
              }
              const d = Number(i.diferencia || 0);
              return (
                <button key={i.id} type="button" onClick={() => setSel({ id: i.id, valor: String(aGrande(i.cantidad_fisica, u)) })}
                  className="w-full flex items-center justify-between gap-2 px-4 py-2 rounded-xl text-left" style={{ background: C.surface, border: `1px solid ${C.border}`, minHeight: 56 }}>
                  <span className="min-w-0">
                    <span className="block text-sm font-bold text-ink truncate">{i.insumos?.nombre}</span>
                    <span className="block text-xs" style={{ color: C.dimmer }}>Contaste {fmtCantidad(i.cantidad_fisica, u)} · debía {fmtCantidad(i.cantidad_teorica, u)}</span>
                  </span>
                  <span className="text-sm font-bold shrink-0" style={{ color: d < 0 ? C.bad : d > 0 ? C.ok : C.dim }}>{d > 0 ? '+' : ''}{fmtCantidad(d, u)}</span>
                </button>
              );
            })}
          </div>
          <AccionesEdicion guardando={guardando} textoEliminar="Eliminar conteo"
            onEliminar={() => correr(() => supabase.rpc('anular_conteo', { p_conteo: conteo.id }), 'Conteo eliminado: el inventario quedó como antes', true)}
            onCancelar={onClose}
            avisoEliminar="Se revierten todos sus ajustes: el inventario y la merma quedan como antes de este conteo." />
        </>
      )}
    </Sheet>
  );
}
