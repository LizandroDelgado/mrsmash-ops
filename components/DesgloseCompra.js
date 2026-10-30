'use client';
// Hoja "Insumos de esta compra": desglose opcional de una compra para que entre al inventario.
// Cada partida crea un movimiento 'compra' y recalcula el costo promedio (trigger en Postgres).
import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { formatMXN, formatMXN2 } from '@/lib/calculos';
import { NEGOCIO_ID, vibrar, msgError } from '@/lib/negocio';
import { UNIDAD_GRANDE } from '@/lib/inventario';
import { C, Sheet, Label, Chips, MontoInput, CantidadInput, BotonPrincipal } from '@/components/ui';
import BuscadorInsumos from '@/components/BuscadorInsumos';

// Unidades en que se puede comprar cada insumo, con su factor a unidad_base
const UNIDADES_COMPRA = {
  g:   [{ key: 'kg', label: 'kg', factor: 1000 }, { key: 'g', label: 'g', factor: 1 }],
  ml:  [{ key: 'L', label: 'L', factor: 1000 }, { key: 'ml', label: 'ml', factor: 1 }],
  // Porciones (mayonesa, catsup…) también se compran por peso: factor = 1000 / gramos_por_porcion
  pza: [{ key: 'pza', label: 'Piezas', factor: 1 }, { key: 'caja', label: 'Caja', factor: null },
        { key: 'kg', label: 'kg', factor: null, porPeso: true }, { key: 'L', label: 'L', factor: null, porPeso: true }],
};

export default function DesgloseCompra({ compra, onClose, onCambio }) {
  const [items,     setItems]     = useState([]);
  const [insumos,   setInsumos]   = useState([]);
  const [recientes, setRecientes] = useState([]);
  const [sel,       setSel]       = useState(null);
  const [cantidad,  setCantidad]  = useState('');
  const [uCompra,   setUCompra]   = useState('');
  const [porCaja,   setPorCaja]   = useState('');
  const [costo,     setCosto]     = useState('');
  const [gramos,    setGramos]    = useState('');   // gramos (o ml) por porción
  const [guardando, setGuardando] = useState(false);

  const cargar = async () => {
    const [{ data: its }, { data: ins }, { data: rec }] = await Promise.all([
      supabase.from('compra_items')
        .select('id, cantidad, unidad_compra, factor_conversion, costo_total, insumo_id, insumos(nombre, unidad_base)')
        .eq('compra_id', compra.id).order('created_at'),
      supabase.from('insumos').select('id, nombre, categoria, unidad_base, costo_promedio, activo, gramos_por_porcion')
        .eq('negocio_id', NEGOCIO_ID).eq('activo', true).order('nombre'),
      supabase.from('compra_items').select('insumo_id')
        .eq('negocio_id', NEGOCIO_ID).order('created_at', { ascending: false }).limit(60),
    ]);
    setItems(its || []);
    setInsumos(ins || []);
    const ids = [...new Set((rec || []).map((r) => r.insumo_id))];
    setRecientes(ids.map((id) => (ins || []).find((i) => i.id === id)).filter(Boolean));
  };

  useEffect(() => { if (compra) cargar(); }, [compra?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!compra) return null;

  const desglosado = items.reduce((s, i) => s + Number(i.costo_total), 0);
  const restante   = Math.max(Number(compra.monto) - desglosado, 0);

  const elegir = (ins) => {
    setSel(ins);
    setUCompra(UNIDADES_COMPRA[ins.unidad_base][0].key);
    setCantidad('');
    setPorCaja('');
    setGramos(ins.gramos_por_porcion ? String(Number(ins.gramos_por_porcion)) : '');
    setCosto(restante > 0 ? String(Math.round(restante * 100) / 100) : '');
  };

  const unidadSel = sel && UNIDADES_COMPRA[sel.unidad_base].find((u) => u.key === uCompra);
  const factor    = !unidadSel ? 0
    : unidadSel.porPeso ? (Number(gramos) > 0 ? Math.round((1000 / Number(gramos)) * 1e6) / 1e6 : 0)
    : (unidadSel.factor ?? Number(porCaja));
  const puede     = sel && Number(cantidad) > 0 && factor > 0 && costo !== '' && Number(costo) >= 0;

  const agregar = async () => {
    if (!puede) return;
    setGuardando(true);
    // Recuerda los gramos por porción del insumo para la próxima compra por peso
    if (unidadSel.porPeso && Number(gramos) !== Number(sel.gramos_por_porcion)) {
      const { error: eG } = await supabase.from('insumos').update({ gramos_por_porcion: Number(gramos) }).eq('id', sel.id);
      if (eG) { setGuardando(false); alert(msgError(eG)); return; }
    }
    const { error } = await supabase.from('compra_items').insert({
      negocio_id:        NEGOCIO_ID,
      compra_id:         compra.id,
      insumo_id:         sel.id,
      cantidad:          Number(cantidad),
      unidad_compra:     uCompra,
      factor_conversion: factor,
      costo_total:       Number(costo),
    });
    setGuardando(false);
    if (error) { alert(msgError(error)); return; }
    vibrar();
    setSel(null);
    await cargar();
    onCambio?.();
  };

  const quitar = async (id) => {
    const { error } = await supabase.from('compra_items').delete().eq('id', id);
    if (error) { alert(msgError(error)); return; }
    await cargar();
    onCambio?.();
  };

  return (
    <Sheet open title="Insumos de esta compra" onClose={onClose}>
      <div className="rounded-2xl px-4 py-3" style={{ background: C.surface }}>
        <p className="text-sm text-white truncate">{compra.descripcion}</p>
        <p className="text-xs mt-1" style={{ color: restante > 0.5 ? C.warn : C.ok }}>
          Desglosado {formatMXN(desglosado)} de {formatMXN(Number(compra.monto))}
        </p>
      </div>

      {items.length > 0 && (
        <div className="space-y-2">
          {items.map((i) => {
            const base = Number(i.cantidad) * Number(i.factor_conversion);
            const u = UNIDAD_GRANDE[i.insumos?.unidad_base] || UNIDAD_GRANDE.pza;
            return (
              <div key={i.id} className="flex items-center justify-between px-4 rounded-xl"
                style={{ background: C.surface, minHeight: 56 }}>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-white truncate">{i.insumos?.nombre}</p>
                  <p className="text-xs" style={{ color: C.dimmer }}>
                    {Number(i.cantidad)} {i.unidad_compra} · {formatMXN(Number(i.costo_total))}
                    {base > 0 && ` · ${formatMXN2((Number(i.costo_total) / base) * u.factor)}/${u.label}`}
                  </p>
                </div>
                <button type="button" onClick={() => quitar(i.id)} aria-label="Quitar"
                  className="flex items-center justify-center rounded-xl shrink-0"
                  style={{ width: 48, height: 48, background: C.surface2 }}>
                  <Trash2 size={16} style={{ color: C.dimmer }} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {!sel ? (
        <div>
          <Label>{items.length ? 'AGREGAR OTRO' : '¿QUÉ INSUMOS VENÍAN?'}</Label>
          <BuscadorInsumos insumos={insumos} recientes={recientes} excluir={items.map((i) => i.insumo_id)}
            onElegir={elegir} onCreado={(n) => setInsumos((p) => [...p, n])} />
        </div>
      ) : (
        <div className="space-y-3 rounded-2xl p-3" style={{ background: C.surface, border: `1px solid ${C.brand}` }}>
          <div className="flex items-center justify-between">
            <p className="font-bold text-white">{sel.nombre}</p>
            <button type="button" onClick={() => setSel(null)} className="px-3 rounded-xl text-sm"
              style={{ background: C.surface2, color: C.dim, minHeight: 48 }}>Cambiar</button>
          </div>
          <Chips options={UNIDADES_COMPRA[sel.unidad_base]} value={uCompra} onChange={setUCompra} />
          {unidadSel?.porPeso && (
            <div>
              <Label>{uCompra === 'L' ? 'ML' : 'GRAMOS'} POR PORCIÓN {sel.gramos_por_porcion ? '(GUARDADO)' : '(SE GUARDA PARA LA PRÓXIMA)'}</Label>
              <CantidadInput value={gramos} onChange={setGramos} unidad={uCompra === 'L' ? 'ml' : 'g'} />
              {factor > 0 && Number(cantidad) > 0 && (
                <p className="text-xs mt-1" style={{ color: C.dim }}>
                  = {Math.round(Number(cantidad) * factor)} porciones
                </p>
              )}
            </div>
          )}
          {uCompra === 'caja' && (
            <div>
              <Label>PIEZAS POR CAJA</Label>
              <CantidadInput value={porCaja} onChange={setPorCaja} unidad="pza" />
            </div>
          )}
          <div>
            <Label>CANTIDAD</Label>
            <CantidadInput value={cantidad} onChange={setCantidad} unidad={unidadSel?.key === 'caja' ? 'cajas' : uCompra} autoFocus />
          </div>
          <div>
            <Label>¿CUÁNTO COSTÓ ESTE INSUMO?</Label>
            <MontoInput value={costo} onChange={setCosto} />
          </div>
          <BotonPrincipal onClick={agregar} disabled={!puede || guardando}>
            {guardando ? 'Guardando…' : 'Agregar al inventario'}
          </BotonPrincipal>
        </div>
      )}
    </Sheet>
  );
}
