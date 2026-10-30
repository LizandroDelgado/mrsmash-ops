'use client';
// Recetas (BOM) por producto: insumos con cantidad editable, costo en vivo y margen.
// Pensado para capturar un producto completo desde el celular en menos de 2 minutos:
// buscar → tocar → cantidad → Agregar, y crear insumos nuevos sin salir.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, Trash2, RefreshCw } from 'lucide-react';
import BuscadorInsumos from '@/components/BuscadorInsumos';
import { Label, Cargando, BotonPrincipal, CantidadInput, C } from '@/components/ui';
import { supabase } from '@/lib/supabase/client';
import { formatMXN, formatMXN2 } from '@/lib/calculos';
import { NEGOCIO_ID, vibrar, msgError } from '@/lib/negocio';
import { UNIDAD_GRANDE, costoGrande } from '@/lib/inventario';

const margenColor = (p) => (p >= 0.65 ? C.ok : p >= 0.55 ? C.warn : C.bad);

export default function RecetasPage() {
  const [cargando,  setCargando]  = useState(true);
  const [productos, setProductos] = useState([]);
  const [insumos,   setInsumos]   = useState([]);
  const [selId,     setSelId]     = useState(null);
  const [lineas,    setLineas]    = useState([]);   // { id, insumo_id, cantidad (string) }
  const [nuevo,     setNuevo]     = useState(null); // insumo elegido, esperando cantidad
  const [cantNuevo, setCantNuevo] = useState('');
  const [ocupado,   setOcupado]   = useState(false);
  const [usos,      setUsos]      = useState({});   // insumo_id → en cuántas recetas aparece

  const cargar = useCallback(async () => {
    const [{ data: prods }, { data: ins }, { data: rec }] = await Promise.all([
      supabase.from('v_costo_receta').select('*').eq('negocio_id', NEGOCIO_ID).order('orden'),
      supabase.from('insumos').select('id, nombre, categoria, unidad_base, costo_promedio, activo, costo_origen')
        .eq('negocio_id', NEGOCIO_ID).order('nombre'),
      supabase.from('recetas').select('insumo_id').eq('negocio_id', NEGOCIO_ID),
    ]);
    const u = {};
    (rec || []).forEach((r) => { u[r.insumo_id] = (u[r.insumo_id] || 0) + 1; });
    setUsos(u);
    setProductos((prods || []).sort((a, b) => Number(b.disponible) - Number(a.disponible)));
    setInsumos(ins || []);
    setCargando(false);
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const abrir = async (id) => {
    setSelId(id);
    setNuevo(null);
    const { data } = await supabase.from('recetas').select('id, insumo_id, cantidad, notas').eq('producto_id', id).order('created_at');
    setLineas((data || []).map((l) => ({ ...l, cantidad: String(Number(l.cantidad)), guardada: Number(l.cantidad) })));
    window.scrollTo(0, 0);
  };

  const cerrarDetalle = () => { setSelId(null); cargar(); };

  const insumo = (id) => insumos.find((i) => i.id === id);
  const prod   = productos.find((p) => p.producto_id === selId);

  // ── acciones de líneas ──
  const agregar = async () => {
    if (!nuevo || !(Number(cantNuevo) > 0)) return;
    setOcupado(true);
    const { data, error } = await supabase.from('recetas').insert({
      negocio_id: NEGOCIO_ID, producto_id: selId, insumo_id: nuevo.id, cantidad: Number(cantNuevo),
    }).select('id, insumo_id, cantidad').single();
    setOcupado(false);
    if (error) { alert(msgError(error)); return; }
    vibrar();
    setLineas((p) => [...p, { ...data, cantidad: String(Number(data.cantidad)), guardada: Number(data.cantidad) }]);
    setNuevo(null);
    setCantNuevo('');
  };

  const guardarCantidad = async (l) => {
    const q = Number(l.cantidad);
    if (!(q > 0) || q === l.guardada) return;
    const { error } = await supabase.from('recetas').update({ cantidad: q }).eq('id', l.id);
    if (error) { alert(msgError(error)); return; }
    vibrar();
    setLineas((p) => p.map((x) => (x.id === l.id ? { ...x, guardada: q } : x)));
  };

  const quitar = async (l) => {
    const { error } = await supabase.from('recetas').delete().eq('id', l.id);
    if (error) { alert(msgError(error)); return; }
    setLineas((p) => p.filter((x) => x.id !== l.id));
  };

  const sincronizar = async (lista) => {
    setOcupado(true);
    for (const p of lista) {
      const { error } = await supabase.from('productos').update({ costo_insumos: Number(p.costo_receta) }).eq('id', p.producto_id);
      if (error) { alert(msgError(error)); break; }
    }
    setOcupado(false);
    vibrar();
    await cargar();
  };

  const header = (titulo, onBack) => (
    <header className="sticky top-0 z-40 flex items-center gap-3 px-4 py-3"
      style={{ background: C.bg, borderBottom: `1px solid ${C.surface2}` }}>
      {onBack ? (
        <button type="button" onClick={onBack} aria-label="Volver" className="flex items-center justify-center rounded-xl"
          style={{ width: 48, height: 48, background: C.surface2 }}>
          <ChevronLeft size={22} style={{ color: C.dim }} />
        </button>
      ) : (
        <Link href="/inventario" aria-label="Volver" className="flex items-center justify-center rounded-xl"
          style={{ width: 48, height: 48, background: C.surface2 }}>
          <ChevronLeft size={22} style={{ color: C.dim }} />
        </Link>
      )}
      <p className="font-bold text-white text-lg truncate">{titulo}</p>
    </header>
  );

  if (cargando) return <div className="min-h-screen" style={{ background: C.bg }}>{header('Recetas')}<Cargando /></div>;

  // ════════════ Detalle de un producto ════════════
  if (prod) {
    const costoVivo = lineas.reduce((s, l) => s + (Number(l.cantidad) || 0) * Number(insumo(l.insumo_id)?.costo_promedio || 0), 0)
      + (nuevo ? (Number(cantNuevo) || 0) * Number(nuevo.costo_promedio || 0) : 0);
    const precio   = Number(prod.precio_venta);
    const margen   = precio - costoVivo;
    const margenP  = precio > 0 ? margen / precio : 0;
    const registrado = Number(prod.costo_insumos);
    const sinCosto = lineas.some((l) => !(Number(insumo(l.insumo_id)?.costo_promedio) > 0));

    return (
      <div className="min-h-screen" style={{ background: C.bg }}>
        {header(prod.nombre, cerrarDetalle)}
        <main className="px-4 pt-4 pb-10 space-y-4">
          <div className="rounded-2xl p-4" style={{ background: C.surface }}>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-xs" style={{ color: C.dim }}>Precio</p>
                <p className="font-bold text-white">{formatMXN(precio)}</p>
              </div>
              <div>
                <p className="text-xs" style={{ color: C.dim }}>Costo receta</p>
                <p className="font-bold text-white">{formatMXN2(costoVivo)}</p>
              </div>
              <div>
                <p className="text-xs" style={{ color: C.dim }}>Margen</p>
                <p className="font-bold" style={{ color: margenColor(margenP) }}>{formatMXN2(margen)}</p>
                <p className="text-xs font-bold" style={{ color: margenColor(margenP) }}>{(margenP * 100).toFixed(0)}%</p>
              </div>
            </div>
            {lineas.length > 0 && Math.abs(costoVivo - registrado) >= 0.01 && (
              <div className="flex items-center justify-between gap-2 mt-3 pt-3" style={{ borderTop: `1px solid ${C.border}` }}>
                <p className="text-xs" style={{ color: C.dim }}>
                  Costo registrado {formatMXN2(registrado)} → receta {formatMXN2(costoVivo)}
                </p>
                <button type="button" disabled={ocupado}
                  onClick={() => sincronizar([{ producto_id: prod.producto_id, costo_receta: Math.round(costoVivo * 100) / 100 }])}
                  className="px-3 rounded-xl text-xs font-bold shrink-0" style={{ background: C.surface2, color: C.brand, minHeight: 48 }}>
                  Usar receta
                </button>
              </div>
            )}
            {sinCosto && (
              <p className="text-xs mt-2" style={{ color: C.warn }}>Hay insumos sin costo: regístralos en una compra o en la carga inicial.</p>
            )}
          </div>

          {lineas.length > 0 && (
            <div className="space-y-2">
              <Label>LLEVA</Label>
              {lineas.map((l) => {
                const i = insumo(l.insumo_id);
                if (!i) return null;
                const costoLinea = (Number(l.cantidad) || 0) * Number(i.costo_promedio);
                return (
                  <div key={l.id} className="rounded-xl p-3 space-y-2" style={{ background: C.surface }}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-bold text-white truncate">
                        {i.nombre}
                        {l.notas && (
                          <span className="ml-2 px-2 py-0.5 rounded-md text-xs font-bold" style={{ background: `${C.warn}22`, color: C.warn }}>
                            {l.notas}
                          </span>
                        )}
                      </p>
                      <p className="text-sm font-bold shrink-0" style={{ color: Number(i.costo_promedio) > 0 ? '#fff' : C.warn }}>
                        {Number(i.costo_promedio) > 0 ? formatMXN2(costoLinea) : 'sin costo'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <CantidadInput value={l.cantidad} unidad={i.unidad_base}
                          onChange={(v) => setLineas((p) => p.map((x) => (x.id === l.id ? { ...x, cantidad: v } : x)))}
                          onEnter={() => guardarCantidad(l)} />
                      </div>
                      {Number(l.cantidad) > 0 && Number(l.cantidad) !== l.guardada ? (
                        <button type="button" onClick={() => guardarCantidad(l)} className="px-4 rounded-xl font-bold text-sm"
                          style={{ background: C.brand, color: '#fff', minHeight: 52 }}>OK</button>
                      ) : (
                        <button type="button" onClick={() => quitar(l)} aria-label="Quitar" className="flex items-center justify-center rounded-xl"
                          style={{ width: 52, height: 52, background: C.surface2 }}>
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
              <BuscadorInsumos insumos={insumos} excluir={lineas.map((l) => l.insumo_id)}
                recientes={insumos.filter((i) => i.activo && usos[i.id]).sort((a, b) => usos[b.id] - usos[a.id])}
                onElegir={(i) => { setNuevo(i); setCantNuevo(''); }}
                onCreado={(n) => setInsumos((p) => [...p, n])} />
            </div>
          ) : (
            <div className="rounded-2xl p-3 space-y-3" style={{ background: C.surface, border: `1px solid ${C.brand}` }}>
              <div className="flex items-center justify-between">
                <p className="font-bold text-white">{nuevo.nombre}</p>
                <button type="button" onClick={() => setNuevo(null)} className="px-3 rounded-xl text-sm"
                  style={{ background: C.surface2, color: C.dim, minHeight: 48 }}>Cambiar</button>
              </div>
              <div>
                <Label>¿CUÁNTO LLEVA UN {prod.nombre.toUpperCase()}?</Label>
                <CantidadInput value={cantNuevo} onChange={setCantNuevo} unidad={nuevo.unidad_base} autoFocus onEnter={agregar} />
              </div>
              <BotonPrincipal onClick={agregar} disabled={!(Number(cantNuevo) > 0) || ocupado}>Agregar</BotonPrincipal>
            </div>
          )}
        </main>
      </div>
    );
  }

  // ════════════ Lista de productos ════════════
  const desfasados = productos.filter((p) => Number(p.n_insumos) > 0 && Math.abs(Number(p.diferencia)) >= 0.01);
  return (
    <div className="min-h-screen" style={{ background: C.bg }}>
      {header('Recetas y costos')}
      <main className="px-4 pt-4 pb-10 space-y-3">
        <p className="text-sm" style={{ color: C.dim }}>
          Toca un producto para armar su receta. Al vender, se descuenta del inventario solo.
        </p>
        {desfasados.length > 0 && (
          <button type="button" disabled={ocupado}
            onClick={() => { if (confirm(`¿Actualizar el costo registrado de ${desfasados.length} producto(s) con el costo de su receta?`)) sincronizar(desfasados); }}
            className="w-full flex items-center justify-center gap-2 rounded-2xl font-bold"
            style={{ background: `${C.brand}22`, color: C.brand, minHeight: 52, border: `1px solid ${C.brand}66` }}>
            <RefreshCw size={16} /> Sincronizar costos con recetas ({desfasados.length})
          </button>
        )}
        {productos.map((p) => {
          const tiene  = Number(p.n_insumos) > 0;
          const costo  = tiene ? Number(p.costo_receta) : Number(p.costo_insumos);
          const precio = Number(p.precio_venta);
          const mp     = precio > 0 ? (precio - costo) / precio : 0;
          return (
            <button key={p.producto_id} type="button" onClick={() => abrir(p.producto_id)}
              className="w-full flex items-center justify-between gap-2 px-4 py-2 rounded-xl text-left"
              style={{ background: C.surface, minHeight: 60, opacity: p.disponible ? 1 : 0.5 }}>
              <span className="min-w-0">
                <span className="block font-bold text-white truncate">{p.nombre}</span>
                <span className="block text-xs" style={{ color: tiene ? C.dimmer : C.warn }}>
                  {tiene ? `${p.n_insumos} insumos` : 'Sin receta · usa costo registrado'}
                  {tiene && Math.abs(Number(p.diferencia)) >= 0.01 && ` · registrado ${formatMXN2(Number(p.costo_insumos))}`}
                </span>
              </span>
              <span className="text-right shrink-0">
                <span className="block text-sm font-bold text-white">{formatMXN2(costo)}</span>
                <span className="block text-xs font-bold" style={{ color: margenColor(mp) }}>margen {(mp * 100).toFixed(0)}%</span>
              </span>
            </button>
          );
        })}
      </main>
    </div>
  );
}
