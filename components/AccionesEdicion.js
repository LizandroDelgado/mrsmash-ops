'use client';
// Patrón único al editar cualquier registro: Guardar cambios · Eliminar (rojo, pide "¿Seguro?") · Cancelar.
import { useState } from 'react';
import { BotonPrincipal, C } from '@/components/ui';

export default function AccionesEdicion({
  onGuardar, onEliminar, onCancelar, guardando = false, puedeGuardar = true,
  textoGuardar = 'Guardar cambios', textoEliminar = 'Eliminar', avisoEliminar,
}) {
  const [confirmar, setConfirmar] = useState(false);
  return (
    <div className="space-y-2 pt-2">
      {onGuardar && (
        <BotonPrincipal onClick={onGuardar} disabled={!puedeGuardar || guardando}>
          {guardando ? 'Guardando…' : textoGuardar}
        </BotonPrincipal>
      )}
      {onEliminar && (confirmar ? (
        <div className="rounded-card p-3 space-y-2" style={{ background: C.badSoft, border: `1px solid ${C.badLine}` }}>
          <p className="text-sm font-bold text-center" style={{ color: C.bad }}>¿Seguro?</p>
          {avisoEliminar && <p className="text-xs text-center" style={{ color: C.ink }}>{avisoEliminar}</p>}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setConfirmar(false)} className="rounded-full text-base"
              style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.ink, minHeight: 48 }}>No</button>
            <button type="button" disabled={guardando} onClick={async () => { await onEliminar(); setConfirmar(false); }}
              className="rounded-full text-base" style={{ background: C.bad, color: C.onBad, minHeight: 48 }}>
              Sí, {textoEliminar.toLowerCase()}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirmar(true)} className="w-full rounded-full text-base"
          style={{ background: 'transparent', color: C.bad, minHeight: 48 }}>
          {textoEliminar}
        </button>
      ))}
      {onCancelar && (
        <button type="button" onClick={onCancelar} className="w-full rounded-full text-base"
          style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.ink, minHeight: 48 }}>
          Cancelar
        </button>
      )}
    </div>
  );
}
