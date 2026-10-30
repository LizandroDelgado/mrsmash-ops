'use client';
// Editor de receta reutilizable (Recetas e Inventario → Precios y costos).
// Controlado: el padre tiene las líneas y decide si guarda al momento (onConfirmar) o en lote.
import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import BuscadorInsumos from '@/components/BuscadorInsumos';
import { Label, BotonPrincipal, CantidadInput, C } from '@/components/ui';
import { formatMXN2 } from '@/lib/calculos';
import { UNIDAD_GRANDE, costoGrande } from '@/lib/inventario';

// Costo de la receta en vivo (líneas + borrador que se está agregando)
export function costoLineas(lineas, insumos, borrador) {
  const cp = (id) => Number(insumos.find((i) => i.id === id)?.costo_promedio || 0);
  return lineas.reduce((s, l) => s + (Number(l.cantidad) || 0) * cp(l.insumo_id), 0)
    + (borrador ? (Number(borrador.cantidad) || 0) * Number(borrador.insumo.costo_promedio || 0) : 0);
}

export default function EditorReceta({
  nombreProducto, lineas, insumos, recientes = [], ocupado = false,
  onCantidad, onConfirmar, onQuitar, onAgregar, onInsumoCreado, onBorrador,
}) {
  const [nuevo,     setNuevo]     = useState(null);
  const [cantNuevo, setCantNuevo] = useState('');
  const insumo = (id) => insumos.find((i) => i.id === id);

  useEffect(() => { onBorrador?.(nuevo ? { insumo: nuevo, cantidad: cantNuevo } : null); }, [nuevo, cantNuevo]); // eslint-disable-line react-hooks/exhaustive-deps

  const agregar = async () => {
    if (!nuevo || !(Number(cantNuevo) > 0)) return;
    const ok = await onAgregar(nuevo, Number(cantNuevo));
    if (ok !== false) { setNuevo(null); setCantNuevo(''); }
  };

  return (
    <div className="space-y-4">
      {lineas.length > 0 && (
        <div className="space-y-2">
          <Label>LLEVA</Label>
          {lineas.map((l) => {
            const i = insumo(l.insumo_id);
            if (!i) return null;
            const costoLinea = (Number(l.cantidad) || 0) * Number(i.costo_promedio);
            return (
              <div key={l.key} className="rounded-xl p-3 space-y-2" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
                <div className="flex items-center justify-between gap-2">
                  <p className="font-bold text-ink truncate">
                    {i.nombre}
                    {l.notas && (
                      <span className="ml-2 px-2 py-0.5 rounded-md text-xs font-bold" style={{ background: C.warnSoft, color: C.warn }}>
                        {l.notas}
                      </span>
                    )}
                  </p>
                  <p className="text-sm font-bold shrink-0" style={{ color: Number(i.costo_promedio) > 0 ? C.ink : C.warn }}>
                    {Number(i.costo_promedio) > 0 ? formatMXN2(costoLinea) : 'sin costo'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <CantidadInput value={l.cantidad} unidad={i.unidad_base}
                      onChange={(v) => onCantidad(l, v)} onEnter={() => onConfirmar?.(l)} />
                  </div>
                  {onConfirmar && l.pendiente && Number(l.cantidad) > 0 ? (
                    <button type="button" onClick={() => onConfirmar(l)} className="px-4 rounded-full text-sm"
                      style={{ background: C.brandFill, color: C.onBrand, minHeight: 52 }}>OK</button>
                  ) : (
                    <button type="button" onClick={() => onQuitar(l)} aria-label="Quitar" className="flex items-center justify-center rounded-full"
                      style={{ width: 52, height: 52, background: C.surface, border: `1px solid ${C.border}` }}>
                      <Trash2 size={18} style={{ color: C.dimmer }} />
                    </button>
                  )}
                </div>
                {Number(i.costo_promedio) > 0 && (
                  <p className="text-xs" style={{ color: C.dimmer }}>
                    {formatMXN2(costoGrande(i.costo_promedio, i.unidad_base))}/{UNIDAD_GRANDE[i.unidad_base].label}
                    {i.costo_origen === 'excel' && ' · costo de referencia'}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!nuevo ? (
        <div>
          <Label>{lineas.length ? 'AGREGAR INSUMO' : '¿QUÉ LLEVA? BUSCA O CREA EL INSUMO'}</Label>
          <BuscadorInsumos insumos={insumos} excluir={lineas.map((l) => l.insumo_id)} recientes={recientes}
            onElegir={(i) => { setNuevo(i); setCantNuevo(''); }} onCreado={onInsumoCreado} />
        </div>
      ) : (
        <div className="rounded-card p-3 space-y-3" style={{ background: C.surface, border: `1px solid ${C.brandLine}` }}>
          <div className="flex items-center justify-between">
            <p className="font-bold text-ink">{nuevo.nombre}</p>
            <button type="button" onClick={() => setNuevo(null)} className="px-3 rounded-full text-sm"
              style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.ink, minHeight: 48 }}>Cambiar</button>
          </div>
          <div>
            <Label>¿CUÁNTO LLEVA UN {nombreProducto.toUpperCase()}?</Label>
            <CantidadInput value={cantNuevo} onChange={setCantNuevo} unidad={nuevo.unidad_base} autoFocus onEnter={agregar} />
          </div>
          <BotonPrincipal onClick={agregar} disabled={!(Number(cantNuevo) > 0) || ocupado}>Agregar</BotonPrincipal>
        </div>
      )}
    </div>
  );
}
