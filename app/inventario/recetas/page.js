'use client';
// Recetas (BOM) por producto: insumos con cantidad editable, costo en vivo y margen.
// Pensado para capturar un producto completo desde el celular en menos de 2 minutos:
// buscar → tocar → cantidad → Agregar, y crear insumos nuevos sin salir.
// Cada línea se guarda al momento; productos.costo_insumos se sincroniza solo (trigger).
import { useCallback, useEffect, useState } from 'react';
import EditorReceta, { costoLineas } from '@/components/EditorReceta';
import { Cargando, C, Header } from '@/components/ui';
import { supabase } from '@/lib/supabase/client';
import { formatMXN, formatMXN2 } from '@/lib/calculos';
import { NEGOCIO_ID, vibrar, msgError } from '@/lib/negocio';

const margenColor = (p) => (p >= 0.65 ? C.ok : p >= 0.55 ? C.warn : C.bad);

export default function RecetasPage() {
  const [cargando,  setCargando]  = useState(true);
  const [productos, setProductos] = useState([]);
  const [insumos,   setInsumos]   = useState([]);
  const [selId,     setSelId]     = useState(null);
  const [lineas,    setLineas]    = useState([]);   // { key, id, insumo_id, cantidad (string), guardada, pendiente }
  const [borrador,  setBorrador]  = useState(null);
  const [ocupado,   setOcupado]   = useState(false);
  const [usos,      setUsos]      = useState({});   // insumo_id → en cuántas recetas aparece

  const cargar = useCallback(async () => {
    const [{ data: prods }, { data: precios }, { data: ins }, { data: rec }] = await Promise.all([
      supabase.from('v_costo_receta').select('*').eq('negocio_id', NEGOCIO_ID).order('orden'),
      supabase.from('productos').select('id, precio_whatsapp, precio_venta').eq('negocio_id', NEGOCIO_ID),
      supabase.from('insumos').select('id, nombre, categoria, unidad_base, costo_promedio, activo, costo_origen')
        .eq('negocio_id', NEGOCIO_ID).order('nombre'),
      supabase.from('recetas').select('insumo_id').eq('negocio_id', NEGOCIO_ID),
    ]);
    const u = {};
    (rec || []).forEach((r) => { u[r.insumo_id] = (u[r.insumo_id] || 0) + 1; });
    setUsos(u);
    // Margen contra el precio de WhatsApp (canal directo); precio_venta ya no se usa en ventas
    const precio = Object.fromEntries((precios || []).map((p) => [p.id, Number(p.precio_whatsapp ?? p.precio_venta)]));
    setProductos((prods || []).map((p) => ({ ...p, precio: precio[p.producto_id] }))
      .sort((a, b) => Number(b.disponible) - Number(a.disponible)));
    setInsumos(ins || []);
    setCargando(false);
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const aLinea = (l) => ({ ...l, key: l.id, cantidad: String(Number(l.cantidad)), guardada: Number(l.cantidad), pendiente: false });

  const abrir = async (id) => {
    setSelId(id);
    const { data } = await supabase.from('recetas').select('id, insumo_id, cantidad, notas').eq('producto_id', id).order('created_at');
    setLineas((data || []).map(aLinea));
    window.scrollTo(0, 0);
  };

  const cerrarDetalle = () => { setSelId(null); cargar(); };
  const prod = productos.find((p) => p.producto_id === selId);

  // ── acciones de líneas: se guardan al momento ──
  const agregar = async (insumo, cantidad) => {
    setOcupado(true);
    const { data, error } = await supabase.from('recetas').insert({
      negocio_id: NEGOCIO_ID, producto_id: selId, insumo_id: insumo.id, cantidad,
    }).select('id, insumo_id, cantidad, notas').single();
    setOcupado(false);
    if (error) { alert(msgError(error)); return false; }
    vibrar();
    setLineas((p) => [...p, aLinea(data)]);
    return true;
  };

  const guardarCantidad = async (l) => {
    const q = Number(l.cantidad);
    if (!(q > 0) || q === l.guardada) return;
    const { error } = await supabase.from('recetas').update({ cantidad: q }).eq('id', l.id);
    if (error) { alert(msgError(error)); return; }
    vibrar();
    setLineas((p) => p.map((x) => (x.id === l.id ? { ...x, guardada: q, pendiente: false } : x)));
  };

  const quitar = async (l) => {
    const { error } = await supabase.from('recetas').delete().eq('id', l.id);
    if (error) { alert(msgError(error)); return; }
    setLineas((p) => p.filter((x) => x.id !== l.id));
  };

  const header = (titulo, onBack) => <Header titulo={titulo} back={onBack || '/inventario'} />;

  if (cargando) return <div className="min-h-screen" style={{ background: C.bg }}>{header('Recetas')}<Cargando /></div>;

  // ════════════ Detalle de un producto ════════════
  if (prod) {
    const costoVivo = costoLineas(lineas, insumos, borrador);
    const precio   = Number(prod.precio) || 0;
    const margen   = precio - costoVivo;
    const margenP  = precio > 0 ? margen / precio : 0;
    const sinCosto = lineas.some((l) => !(Number(insumos.find((i) => i.id === l.insumo_id)?.costo_promedio) > 0));

    return (
      <div className="min-h-screen" style={{ background: C.bg }}>
        {header(prod.nombre, cerrarDetalle)}
        <main className="px-4 pt-4 pb-10 space-y-4">
          <div className="rounded-2xl p-4" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-xs" style={{ color: C.dim }}>Precio WhatsApp</p>
                <p className="font-bold text-ink">{formatMXN(precio)}</p>
              </div>
              <div>
                <p className="text-xs" style={{ color: C.dim }}>Costo receta</p>
                <p className="font-bold text-ink">{formatMXN2(costoVivo)}</p>
              </div>
              <div>
                <p className="text-xs" style={{ color: C.dim }}>Margen</p>
                <p className="font-bold" style={{ color: margenColor(margenP) }}>{formatMXN2(margen)}</p>
                <p className="text-xs font-bold" style={{ color: margenColor(margenP) }}>{(margenP * 100).toFixed(0)}%</p>
              </div>
            </div>
            <p className="text-xs mt-3" style={{ color: C.dimmer }}>
              El costo del producto se actualiza solo con su receta. Precios por canal: Configuración → Precios y costos.
            </p>
            {sinCosto && (
              <p className="text-xs mt-2" style={{ color: C.warn }}>Hay insumos sin costo: regístralos en una compra o en la carga inicial.</p>
            )}
          </div>

          <EditorReceta nombreProducto={prod.nombre} lineas={lineas} insumos={insumos} ocupado={ocupado}
            recientes={insumos.filter((i) => i.activo && usos[i.id]).sort((a, b) => usos[b.id] - usos[a.id])}
            onCantidad={(l, v) => setLineas((p) => p.map((x) => (x.key === l.key ? { ...x, cantidad: v, pendiente: Number(v) !== x.guardada } : x)))}
            onConfirmar={guardarCantidad} onQuitar={quitar} onAgregar={agregar}
            onInsumoCreado={(n) => setInsumos((p) => [...p, n])} onBorrador={setBorrador} />
        </main>
      </div>
    );
  }

  // ════════════ Lista de productos ════════════
  return (
    <div className="min-h-screen" style={{ background: C.bg }}>
      {header('Recetas y costos')}
      <main className="px-4 pt-4 pb-10 space-y-3">
        <p className="text-sm" style={{ color: C.dim }}>
          Toca un producto para armar su receta. Al vender, se descuenta del inventario solo.
        </p>
        {productos.map((p) => {
          const tiene  = Number(p.n_insumos) > 0;
          const costo  = tiene ? Number(p.costo_receta) : Number(p.costo_insumos);
          const precio = Number(p.precio) || 0;
          const mp     = precio > 0 ? (precio - costo) / precio : 0;
          return (
            <button key={p.producto_id} type="button" onClick={() => abrir(p.producto_id)}
              className="w-full flex items-center justify-between gap-2 px-4 py-2 rounded-xl text-left"
              style={{ background: C.surface, border: `1px solid ${C.border}`, minHeight: 60, opacity: p.disponible ? 1 : 0.5 }}>
              <span className="min-w-0">
                <span className="block font-bold text-ink truncate">{p.nombre}</span>
                <span className="block text-xs" style={{ color: tiene ? C.dimmer : C.warn }}>
                  {tiene ? `${p.n_insumos} insumos` : 'Sin receta · usa costo registrado'}
                </span>
              </span>
              <span className="text-right shrink-0">
                <span className="block text-sm font-bold text-ink">{formatMXN2(costo)}</span>
                <span className="block text-xs font-bold" style={{ color: margenColor(mp) }}>margen {(mp * 100).toFixed(0)}%</span>
              </span>
            </button>
          );
        })}
      </main>
    </div>
  );
}
