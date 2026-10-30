'use client';
// Panel de precios y costos. Los cambios se acumulan en un lote (en memoria) y se guardan
// juntos con la RPC aplicar_cambios_precios_costos: todo o nada, con historial.
// El histórico de ventas no se toca: pedido_items guarda precio y costo de cada venta.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, ChevronRight, AlertTriangle, X } from 'lucide-react';
import EditorReceta from '@/components/EditorReceta';
import BuscadorInsumos from '@/components/BuscadorInsumos';
import { Header, Label, Chips, Sheet, Cargando, BotonPrincipal, BotonSecundario, MontoInput, CantidadInput, TextInput, C } from '@/components/ui';
import { supabase } from '@/lib/supabase/client';
import { formatMXN, formatMXN2 } from '@/lib/calculos';
import { formatDiaCorto, diaOperativo } from '@/lib/dia';
import { NEGOCIO_ID, vibrar, msgError } from '@/lib/negocio';
import { CATEGORIAS_INSUMO, UNIDAD_GRANDE, costoGrande, copiarTexto } from '@/lib/inventario';
import {
  CANALES_PRECIO, CATEGORIAS_PRODUCTO, margenCanal, precioSugerido, subirPrecio, precioNeto, costoBaseDesdeCompra,
} from '@/lib/precios';

const TABS = [{ key: 'productos', label: 'Productos' }, { key: 'insumos', label: 'Insumos' }, { key: 'masivo', label: 'Masivo' }, { key: 'historial', label: 'Historial' }];
const CAMPOS = { precio_whatsapp: 'WhatsApp', precio_didi: 'Didi', precio_salon: 'Salón', precio_venta: 'Precio lista', costo_insumos: 'Costo', disponible: 'Disponible' };
const SEM = { verde: [C.ok, C.okSoft], ambar: [C.warn, C.warnSoft], rojo: [C.bad, C.badSoft] };
const UNIDADES_COMPRA = {
  g:   [{ key: 'kg', label: 'kg', factor: 1000 }, { key: 'g', label: 'g', factor: 1 }],
  ml:  [{ key: 'L', label: 'L', factor: 1000 }, { key: 'ml', label: 'ml', factor: 1 }],
  pza: [{ key: 'pza', label: 'Piezas', factor: 1 }],
};
const n = (x) => Number(x) || 0;
const pct = (x, d = 0) => (x == null ? '—' : `${(x * 100).toFixed(d)}%`);
const iguales = (a, b) => Math.abs(n(a) - n(b)) < 0.005;
const LS_AVISO = 'precios_aviso_pendiente';

function ChipMargen({ m }) {
  if (!m) return <span className="text-xs" style={{ color: C.dimmer }}>—</span>;
  const [fg, bg] = SEM[m.semaforo];
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold" style={{ background: bg, color: fg }}>
      <span className="inline-block rounded-full" style={{ width: 6, height: 6, background: fg }} />
      {formatMXN(m.margen)} · {pct(m.pct)}
    </span>
  );
}

export default function PreciosCostosPage() {
  const [tab,       setTab]       = useState('productos');
  const [cargando,  setCargando]  = useState(true);
  const [productos, setProductos] = useState([]);
  const [insumos,   setInsumos]   = useState([]);
  const [recetas,   setRecetas]   = useState([]);
  const [cfg,       setCfg]       = useState({});
  const [volumen,   setVolumen]   = useState({ porProducto: {}, desde: null, hasta: null });
  const [ultCosto,  setUltCosto]  = useState({});
  const [historial, setHistorial] = useState([]);
  // Lote pendiente
  const [cPrecios,  setCPrecios]  = useState({});   // producto_id → { campo: valor }
  const [cCostos,   setCCostos]   = useState({});   // insumo_id → costo base
  const [cRecetas,  setCRecetas]  = useState({});   // producto_id → { insumo_id: cantidad (string) }
  // Navegación
  const [prodSel,   setProdSel]   = useState(null);
  const [insSel,    setInsSel]    = useState(null);
  const [revisar,   setRevisar]   = useState(false);
  const [motivo,    setMotivo]    = useState('');
  const [guardando, setGuardando] = useState(false);
  const [aviso,     setAviso]     = useState(null);   // precios cambiados para Soft/Didi

  const cargar = useCallback(async () => {
    const [pr, ins, rec, cf, vol, hc, hp] = await Promise.all([
      supabase.from('productos').select('id, nombre, categoria, orden, disponible, precio_whatsapp, precio_didi, precio_salon, precio_venta, costo_insumos')
        .eq('negocio_id', NEGOCIO_ID).order('orden'),
      supabase.from('insumos').select('id, nombre, categoria, unidad_base, costo_promedio, activo, costo_origen').eq('negocio_id', NEGOCIO_ID).order('nombre'),
      supabase.from('recetas').select('producto_id, insumo_id, cantidad, notas').eq('negocio_id', NEGOCIO_ID),
      supabase.from('configuracion_negocio').select('meta_food_cost, meta_margen_minimo_pct, pct_comision_didi, pct_promos_didi, pct_retenciones_didi').eq('negocio_id', NEGOCIO_ID).single(),
      supabase.rpc('volumen_productos', { p_negocio: NEGOCIO_ID }),
      supabase.from('historial_costos').select('id, insumo_id, costo_anterior, costo_nuevo, origen, motivo, created_at, insumos(nombre, unidad_base)')
        .eq('negocio_id', NEGOCIO_ID).order('created_at', { ascending: false }).limit(150),
      supabase.from('historial_precios').select('id, producto_id, campo, valor_anterior, valor_nuevo, motivo, created_at, productos(nombre)')
        .eq('negocio_id', NEGOCIO_ID).order('created_at', { ascending: false }).limit(150),
    ]);
    setProductos(pr.data || []);
    setInsumos(ins.data || []);
    setRecetas(rec.data || []);
    setCfg(cf.data || {});
    const v = vol.data || [];
    setVolumen({ porProducto: Object.fromEntries(v.map((x) => [x.producto_id, n(x.unidades)])), desde: v[0]?.desde, hasta: v[0]?.hasta });
    const ult = {};
    (hc.data || []).forEach((h) => { if (!ult[h.insumo_id]) ult[h.insumo_id] = h; });
    setUltCosto(ult);
    setHistorial([
      ...(hc.data || []).map((h) => ({ ...h, tipo: 'costo', nombre: h.insumos?.nombre, unidad: h.insumos?.unidad_base })),
      ...(hp.data || []).map((h) => ({ ...h, tipo: 'precio', nombre: h.productos?.nombre })),
    ].sort((a, b) => b.created_at.localeCompare(a.created_at)));
    setCargando(false);
  }, []);

  useEffect(() => {
    cargar();
    try { const a = localStorage.getItem(LS_AVISO); if (a) setAviso(JSON.parse(a)); } catch { /* sin almacenamiento */ }
  }, [cargar]);

  // ── Valores efectivos (original + lote) ──
  const costoInsumo = useCallback((id) => (id in cCostos ? n(cCostos[id]) : n(insumos.find((i) => i.id === id)?.costo_promedio)), [cCostos, insumos]);
  const lineasDe = useCallback((pid) => {
    const orig = recetas.filter((r) => r.producto_id === pid);
    const cam = cRecetas[pid] || {};
    const out = orig.filter((r) => !(r.insumo_id in cam) || n(cam[r.insumo_id]) > 0)
      .map((r) => ({ key: r.insumo_id, insumo_id: r.insumo_id, notas: r.notas, cantidad: r.insumo_id in cam ? String(cam[r.insumo_id]) : String(n(r.cantidad)) }));
    Object.entries(cam).forEach(([iid, q]) => { if (!orig.some((r) => r.insumo_id === iid) && n(q) > 0) out.push({ key: iid, insumo_id: iid, cantidad: String(q) }); });
    return out;
  }, [recetas, cRecetas]);
  const costoProducto = useCallback((p, conCostos = true) => {
    const ls = lineasDe(p.id);
    if (ls.length) return ls.reduce((s, l) => s + n(l.cantidad) * (conCostos ? costoInsumo(l.insumo_id) : n(insumos.find((i) => i.id === l.insumo_id)?.costo_promedio)), 0);
    return 'costo_insumos' in (cPrecios[p.id] || {}) ? n(cPrecios[p.id].costo_insumos) : n(p.costo_insumos);
  }, [lineasDe, costoInsumo, cPrecios, insumos]);
  const valor = (p, campo) => (campo in (cPrecios[p.id] || {}) ? cPrecios[p.id][campo] : p[campo]);

  const setPrecio = (p, campo, v) => setCPrecios((prev) => {
    const actual = { ...(prev[p.id] || {}) };
    const igual = campo === 'disponible' ? v === p[campo] : (v === '' ? p[campo] == null : iguales(v, p[campo]) && p[campo] != null);
    if (igual) delete actual[campo]; else actual[campo] = v;
    const sig = { ...prev, [p.id]: actual };
    if (!Object.keys(actual).length) delete sig[p.id];
    return sig;
  });
  const setReceta = (pid, iid, q) => setCRecetas((prev) => {
    const orig = recetas.find((r) => r.producto_id === pid && r.insumo_id === iid);
    const actual = { ...(prev[pid] || {}) };
    if ((orig && String(n(orig.cantidad)) === String(q)) || (!orig && !(n(q) > 0))) delete actual[iid]; else actual[iid] = q;
    const sig = { ...prev, [pid]: actual };
    if (!Object.keys(actual).length) delete sig[pid];
    return sig;
  });
  const setCosto = (iid, v) => setCCostos((prev) => {
    const orig = n(insumos.find((i) => i.id === iid)?.costo_promedio);
    const sig = { ...prev };
    if (Math.abs(n(v) - orig) < 1e-6) delete sig[iid]; else sig[iid] = Math.round(n(v) * 1e6) / 1e6;
    return sig;
  });

  // ── Resumen del lote ──
  const resumen = useMemo(() => {
    const filas = [];
    Object.entries(cPrecios).forEach(([pid, campos]) => {
      const p = productos.find((x) => x.id === pid);
      Object.entries(campos).forEach(([campo, v]) => filas.push({ tipo: 'precio', id: `${pid}-${campo}`, nombre: p?.nombre, campo, antes: p?.[campo], despues: v }));
    });
    Object.entries(cCostos).forEach(([iid, v]) => {
      const i = insumos.find((x) => x.id === iid);
      filas.push({ tipo: 'costo', id: iid, nombre: i?.nombre, campo: 'costo', antes: n(i?.costo_promedio), despues: v, unidad: i?.unidad_base });
    });
    Object.entries(cRecetas).forEach(([pid, cam]) => {
      const p = productos.find((x) => x.id === pid);
      Object.entries(cam).forEach(([iid, q]) => {
        const orig = recetas.find((r) => r.producto_id === pid && r.insumo_id === iid);
        const i = insumos.find((x) => x.id === iid);
        filas.push({ tipo: 'receta', id: `${pid}-${iid}`, nombre: `${p?.nombre}: ${i?.nombre}`, antes: orig ? n(orig.cantidad) : null, despues: n(q), unidad: i?.unidad_base });
      });
    });
    return filas;
  }, [cPrecios, cCostos, cRecetas, productos, insumos, recetas]);

  const guardar = async () => {
    setGuardando(true);
    const payload = {
      negocio_id: NEGOCIO_ID, motivo: motivo.trim() || null,
      costos: Object.entries(cCostos).map(([insumo_id, costo_unitario]) => ({ insumo_id, costo_unitario })),
      recetas: Object.entries(cRecetas).flatMap(([producto_id, cam]) => Object.entries(cam).map(([insumo_id, q]) => ({ producto_id, insumo_id, cantidad: n(q) }))),
      precios: Object.entries(cPrecios).map(([producto_id, campos]) => ({
        producto_id,
        ...Object.fromEntries(Object.entries(campos).map(([k, v]) => [k, k === 'disponible' ? v : (v === '' ? null : n(v))])),
      })),
    };
    const { error } = await supabase.rpc('aplicar_cambios_precios_costos', { p_payload: payload });
    setGuardando(false);
    if (error) { alert('No se guardó nada: ' + msgError(error)); return; }
    vibrar();
    // Recordatorio fijo para Soft Restaurant y Didi Food
    const cambiosPrecio = resumen.filter((f) => f.tipo === 'precio' && f.campo.startsWith('precio_'));
    if (cambiosPrecio.length) {
      const a = { fecha: diaOperativo(), lineas: cambiosPrecio.map((f) => `${f.nombre} · ${CAMPOS[f.campo]}: ${formatMXN(n(f.antes))} → ${formatMXN(n(f.despues))}`) };
      setAviso(a);
      try { localStorage.setItem(LS_AVISO, JSON.stringify(a)); } catch { /* sin almacenamiento */ }
    }
    setCPrecios({}); setCCostos({}); setCRecetas({}); setMotivo(''); setRevisar(false); setProdSel(null); setInsSel(null);
    await cargar();
  };

  const cerrarAviso = () => { setAviso(null); try { localStorage.removeItem(LS_AVISO); } catch { /* sin almacenamiento */ } };

  // Impacto de nuevos costos de insumos sobre los productos que los usan
  const impacto = useCallback((nuevos) => {
    const afectados = productos.filter((p) => lineasDe(p.id).some((l) => l.insumo_id in nuevos));
    const filas = afectados.map((p) => {
      const ls = lineasDe(p.id);
      const antes = ls.reduce((s, l) => s + n(l.cantidad) * costoInsumo(l.insumo_id), 0);
      const despues = ls.reduce((s, l) => s + n(l.cantidad) * (l.insumo_id in nuevos ? n(nuevos[l.insumo_id]) : costoInsumo(l.insumo_id)), 0);
      const pw = valor(p, 'precio_whatsapp');
      return { p, antes, despues, mAntes: margenCanal(pw, antes, 'whatsapp', cfg), mDespues: margenCanal(pw, despues, 'whatsapp', cfg),
               dMes: (despues - antes) * (volumen.porProducto[p.id] || 0) };
    });
    return { filas, totalMes: filas.reduce((s, f) => s + f.dMes, 0) };
  }, [productos, lineasDe, costoInsumo, cfg, volumen]); // eslint-disable-line react-hooks/exhaustive-deps

  if (cargando) return <div className="min-h-screen" style={{ background: C.bg }}><Header titulo="Precios y costos" back="/configuracion" /><Cargando /></div>;

  const nCambios = resumen.length;
  const barra = nCambios > 0 && (
    <div className="fixed bottom-0 left-0 right-0 z-50 px-4 pt-3" style={{ background: C.surface, borderTop: `1px solid ${C.border}`, paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
      <BotonPrincipal onClick={() => setRevisar(true)}>Revisar y guardar ({nCambios})</BotonPrincipal>
    </div>
  );

  const avisoCard = aviso && (
    <div className="rounded-card p-4 space-y-2" style={{ background: C.warnSoft, border: `1px solid ${C.warnLine}` }}>
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-start gap-2 text-sm font-bold" style={{ color: C.warn }}>
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          Actualiza también estos precios en Soft Restaurant y en Didi Food; la app no los cambia allá.
        </p>
        <button type="button" onClick={cerrarAviso} aria-label="Ya los actualicé" className="flex items-center justify-center rounded-full shrink-0"
          style={{ width: 44, height: 44, minHeight: 44, background: C.surface, border: `1px solid ${C.border}` }}>
          <X size={16} style={{ color: C.ink }} />
        </button>
      </div>
      <ul className="text-xs space-y-0.5" style={{ color: C.ink }}>{aviso.lineas.map((l) => <li key={l}>{l}</li>)}</ul>
      <BotonSecundario onClick={async () => { if (await copiarTexto(`Precios nuevos MR. SMASH (${aviso.fecha})\n` + aviso.lineas.join('\n'))) vibrar(); }}>
        <span className="flex items-center justify-center gap-2"><Copy size={16} /> Copiar lista</span>
      </BotonSecundario>
    </div>
  );

  // ════════════ Detalle de producto ════════════
  if (prodSel) {
    const p = productos.find((x) => x.id === prodSel);
    const lineas = lineasDe(p.id);
    const costo = costoProducto(p);
    const disponible = valor(p, 'disponible');
    return (
      <div className="min-h-screen pb-28" style={{ background: C.bg }}>
        <Header titulo={p.nombre} back={() => setProdSel(null)} />
        <main className="px-4 pt-4 space-y-4">
          <div className="rounded-card p-4" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
            <div className="flex items-center justify-between">
              <p className="text-sm" style={{ color: C.dim }}>Costo {lineas.length ? 'de receta' : 'registrado (sin receta)'}</p>
              <p className="text-xl font-bold text-ink">{formatMXN2(costo)}</p>
            </div>
            {!lineas.length && (
              <div className="mt-3">
                <Label>COSTO MANUAL (MIENTRAS NO TENGA RECETA)</Label>
                <MontoInput value={'costo_insumos' in (cPrecios[p.id] || {}) ? cPrecios[p.id].costo_insumos : String(n(p.costo_insumos))}
                  onChange={(v) => setPrecio(p, 'costo_insumos', v)} />
              </div>
            )}
          </div>

          <div>
            <Label>¿DISPONIBLE PARA VENDER?</Label>
            <Chips options={[{ key: true, label: 'Sí' }, { key: false, label: 'Pausado' }]} value={!!disponible} onChange={(v) => setPrecio(p, 'disponible', v)} />
          </div>

          {CANALES_PRECIO.map((ch) => {
            const v = valor(p, ch.campo);
            const m = margenCanal(v, costo, ch.key, cfg);
            const sug = precioSugerido(costo, ch.key, cfg);
            return (
              <div key={ch.key} className="rounded-card p-4 space-y-2" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
                <div className="flex items-center justify-between">
                  <p className="font-display text-lg" style={{ color: C.ink, fontWeight: 600 }}>{ch.label}</p>
                  <ChipMargen m={m} />
                </div>
                <MontoInput value={v == null ? '' : String(v)} onChange={(x) => setPrecio(p, ch.campo, x)} />
                <div className="flex items-center justify-between gap-2 text-xs" style={{ color: C.dim }}>
                  <span>
                    {ch.key === 'didi' && v != null && `Neto ${formatMXN2(precioNeto(v, 'didi', cfg))} · deposita ${formatMXN2(n(v) * (1 - n(cfg.pct_comision_didi) - n(cfg.pct_promos_didi) - n(cfg.pct_retenciones_didi)))} · `}
                    Costo de comida {m ? pct(m.fc, 1) : '—'}
                  </span>
                  {sug != null && !iguales(sug, v) && (
                    <button type="button" onClick={() => setPrecio(p, ch.campo, String(sug))} className="px-3 rounded-full shrink-0"
                      style={{ background: C.brandSoft, color: C.brandText, border: `1px solid ${C.brandLine}`, minHeight: 44 }}>
                      Sugerido {formatMXN(sug)}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          <p className="text-xs" style={{ color: C.dimmer }}>
            Sugerido = precio con {pct(n(cfg.meta_margen_minimo_pct))} de margen sobre lo que te llega, terminación 9.
            Verde: costo de comida ≤ {pct(n(cfg.meta_food_cost))}; ámbar: margen ≥ {pct(n(cfg.meta_margen_minimo_pct))}; rojo: abajo.
          </p>

          <section className="space-y-2">
            <p className="font-display text-lg" style={{ color: C.ink, fontWeight: 600 }}>Receta</p>
            <EditorReceta nombreProducto={p.nombre} lineas={lineas} insumos={insumos.map((i) => ({ ...i, costo_promedio: costoInsumo(i.id) }))}
              onCantidad={(l, q) => setReceta(p.id, l.insumo_id, q)} onQuitar={(l) => setReceta(p.id, l.insumo_id, 0)}
              onAgregar={(i, q) => { setReceta(p.id, i.id, String(q)); return true; }}
              onInsumoCreado={(nw) => setInsumos((prev) => [...prev, nw])} />
          </section>
        </main>
        {barra}
        {revisarSheet()}
      </div>
    );
  }

  // ════════════ Detalle de insumo ════════════
  if (insSel) {
    return (
      <EditorCosto insumo={insumos.find((i) => i.id === insSel)} costoActual={costoInsumo(insSel)} ult={ultCosto[insSel]}
        impacto={impacto} volumen={volumen}
        onVolver={() => setInsSel(null)} onAplicar={(v) => { setCosto(insSel, v); setInsSel(null); vibrar(); }}
        onDesactivar={async () => {
          const i = insumos.find((x) => x.id === insSel);
          if (!confirm(`¿Desactivar "${i.nombre}"? No se borra: deja de aparecer en listas y conteos.`)) return;
          const { error } = await supabase.from('insumos').update({ activo: false }).eq('id', insSel);
          if (error) { alert(msgError(error)); return; }
          vibrar(); setInsSel(null); await cargar();
        }} />
    );
  }

  // ════════════ Pestañas ════════════
  function revisarSheet() {
    return (
      <Sheet open={revisar} title="Revisar cambios" onClose={() => setRevisar(false)}>
        <div className="space-y-1">
          {resumen.map((f) => (
            <div key={f.id} className="flex items-center justify-between gap-2 py-2" style={{ borderBottom: `1px solid ${C.border}` }}>
              <span className="min-w-0">
                <span className="block text-sm text-ink truncate">{f.nombre}</span>
                <span className="block text-xs" style={{ color: C.dim }}>
                  {f.tipo === 'precio' ? CAMPOS[f.campo] : f.tipo === 'costo' ? `Costo por ${UNIDAD_GRANDE[f.unidad]?.label}` : `Receta (${f.unidad})`}
                </span>
              </span>
              <span className="text-sm shrink-0 text-right" style={{ color: C.ink }}>
                {f.tipo === 'precio' && f.campo === 'disponible' ? `${f.antes ? 'Sí' : 'Pausado'} → ${f.despues ? 'Sí' : 'Pausado'}`
                  : f.tipo === 'costo' ? `${formatMXN2(costoGrande(f.antes, f.unidad))} → ${formatMXN2(costoGrande(f.despues, f.unidad))}`
                  : f.tipo === 'receta' ? `${f.antes ?? '—'} → ${f.despues || 'quitar'}`
                  : `${f.antes == null ? '—' : formatMXN2(n(f.antes))} → ${formatMXN2(n(f.despues))}`}
              </span>
            </div>
          ))}
        </div>
        <div>
          <Label>MOTIVO (OPCIONAL)</Label>
          <TextInput value={motivo} onChange={setMotivo} placeholder="Ej. subió la carne con el proveedor" />
        </div>
        <p className="text-xs" style={{ color: C.dimmer }}>Las ventas ya registradas conservan su precio y costo. Esto aplica desde ahora.</p>
        <BotonPrincipal onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar cambios'}</BotonPrincipal>
      </Sheet>
    );
  }

  return (
    <div className="min-h-screen pb-28" style={{ background: C.bg }}>
      <Header titulo="Precios y costos" back="/configuracion" />
      <main className="px-4 pt-4 space-y-4">
        {avisoCard}
        <Chips options={TABS} value={tab} onChange={setTab} />

        {tab === 'productos' && CATEGORIAS_PRODUCTO.map((cat) => {
          const lista = productos.filter((p) => (p.categoria || 'burger') === cat.key);
          if (!lista.length) return null;
          return (
            <section key={cat.key} className="space-y-2">
              <Label>{cat.label.toUpperCase()}</Label>
              {lista.map((p) => {
                const costo = costoProducto(p);
                const cambiado = !!cPrecios[p.id] || !!cRecetas[p.id] || lineasDe(p.id).some((l) => l.insumo_id in cCostos);
                return (
                  <button key={p.id} type="button" onClick={() => { setProdSel(p.id); window.scrollTo(0, 0); }}
                    className="w-full text-left rounded-card p-3 space-y-2"
                    style={{ background: C.surface, border: `1px solid ${cambiado ? C.brandLine : C.border}`, opacity: valor(p, 'disponible') ? 1 : 0.6 }}>
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-bold text-ink truncate">{p.nombre}{!valor(p, 'disponible') && ' · pausado'}</span>
                      <span className="text-sm shrink-0" style={{ color: C.dim }}>costo {formatMXN2(costo)}</span>
                    </span>
                    {CANALES_PRECIO.map((ch) => {
                      const v = valor(p, ch.campo);
                      return (
                        <span key={ch.key} className="flex items-center justify-between gap-2 text-sm">
                          <span style={{ color: C.dim }}>{ch.label} <span className="text-ink font-bold">{v == null ? '—' : formatMXN(n(v))}</span></span>
                          <ChipMargen m={margenCanal(v, costo, ch.key, cfg)} />
                        </span>
                      );
                    })}
                  </button>
                );
              })}
            </section>
          );
        })}

        {tab === 'insumos' && (
          <>
            <div>
              <Label>DAR DE ALTA UN INSUMO</Label>
              <BuscadorInsumos insumos={insumos} placeholder="Escribe el nombre del insumo…"
                onElegir={(i) => setInsSel(i.id)} onCreado={(nw) => setInsumos((prev) => [...prev, nw])} />
            </div>
            {CATEGORIAS_INSUMO.map((cat) => {
              const lista = insumos.filter((i) => i.activo && i.categoria === cat.key);
              if (!lista.length) return null;
              return (
                <section key={cat.key} className="space-y-2">
                  <Label>{cat.label.toUpperCase()}</Label>
                  {lista.map((i) => {
                    const u = ultCosto[i.id];
                    const cambiado = i.id in cCostos;
                    return (
                      <button key={i.id} type="button" onClick={() => { setInsSel(i.id); window.scrollTo(0, 0); }}
                        className="w-full flex items-center justify-between gap-2 px-4 py-2 rounded-xl text-left"
                        style={{ background: C.surface, border: `1px solid ${cambiado ? C.brandLine : C.border}`, minHeight: 60 }}>
                        <span className="min-w-0">
                          <span className="block font-bold text-ink truncate">{i.nombre}</span>
                          <span className="block text-xs" style={{ color: C.dimmer }}>
                            {u ? `${formatDiaCorto(u.created_at.slice(0, 10))} · ${u.origen === 'compra' ? 'por compra' : 'manual'}` : 'sin cambios registrados'}
                          </span>
                        </span>
                        <span className="text-right shrink-0">
                          <span className="block font-bold text-ink">{formatMXN2(costoGrande(costoInsumo(i.id), i.unidad_base))}</span>
                          <span className="block text-xs" style={{ color: C.dim }}>por {UNIDAD_GRANDE[i.unidad_base].label === 'pza' ? 'pieza' : UNIDAD_GRANDE[i.unidad_base].label}</span>
                        </span>
                      </button>
                    );
                  })}
                </section>
              );
            })}
          </>
        )}

        {tab === 'masivo' && (
          <AjusteMasivo productos={productos} insumos={insumos.filter((i) => i.activo)} cfg={cfg} valor={valor}
            costoProducto={costoProducto} costoInsumo={costoInsumo} impacto={impacto} volumen={volumen}
            onAplicarPrecios={(lista) => { lista.forEach(({ p, campo, nuevo }) => setPrecio(p, campo, String(nuevo))); vibrar(); }}
            onAplicarCosto={(iid, v) => { setCosto(iid, v); vibrar(); }} />
        )}

        {tab === 'historial' && <Historial historial={historial} />}
      </main>
      {barra}
      {revisarSheet()}
    </div>
  );
}

// ── Editar costo de un insumo "como lo compras", con impacto ──
function EditorCosto({ insumo, costoActual, ult, impacto, volumen, onVolver, onAplicar, onDesactivar }) {
  const unidades = UNIDADES_COMPRA[insumo.unidad_base];
  const [precio,   setPrecio]   = useState('');
  const [cantidad, setCantidad] = useState('1');
  const [uni,      setUni]      = useState(unidades[0].key);
  const factor = unidades.find((u) => u.key === uni)?.factor || 1;
  const nuevo = costoBaseDesdeCompra(precio, cantidad, factor);
  const imp = nuevo != null ? impacto({ [insumo.id]: nuevo }) : null;
  const ug = UNIDAD_GRANDE[insumo.unidad_base];
  const etiqueta = ug.label === 'pza' ? 'pieza' : ug.label;

  return (
    <div className="min-h-screen pb-10" style={{ background: C.bg }}>
      <Header titulo={insumo.nombre} back={onVolver} />
      <main className="px-4 pt-4 space-y-4">
        <div className="rounded-card p-4" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
          <p className="text-sm" style={{ color: C.dim }}>Costo actual</p>
          <p className="text-2xl font-bold text-ink">{formatMXN2(costoGrande(costoActual, insumo.unidad_base))} <span className="text-sm" style={{ color: C.dim }}>por {etiqueta}</span></p>
          <p className="text-xs mt-1" style={{ color: C.dimmer }}>
            {ult ? `Último cambio: ${formatDiaCorto(ult.created_at.slice(0, 10))}, ${ult.origen === 'compra' ? 'por compra' : 'manual'}` : 'Sin cambios registrados'}
          </p>
        </div>

        <div className="space-y-3">
          <Label>¿CÓMO LO COMPRAS AHORA?</Label>
          <div className="grid grid-cols-2 gap-2">
            <MontoInput value={precio} onChange={setPrecio} autoFocus placeholder="Precio" />
            <CantidadInput value={cantidad} onChange={setCantidad} unidad={uni} />
          </div>
          {unidades.length > 1 && <Chips options={unidades} value={uni} onChange={setUni} />}
          <p className="text-xs" style={{ color: C.dim }}>
            Ej. $350 por 1 kg de carne, $95 por 12 piezas de pan.
            {nuevo != null && <> Queda en <b style={{ color: C.ink }}>{formatMXN2(costoGrande(nuevo, insumo.unidad_base))} por {etiqueta}</b>.</>}
          </p>
        </div>

        {imp && (
          <div className="rounded-card p-4 space-y-2" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
            <p className="font-display text-lg" style={{ color: C.ink, fontWeight: 600 }}>Impacto</p>
            {imp.filas.length === 0 ? <p className="text-sm" style={{ color: C.dim }}>Ningún producto usa este insumo en su receta.</p> : (
              <>
                {imp.filas.map((f) => (
                  <div key={f.p.id} className="text-sm py-1" style={{ borderBottom: `1px solid ${C.border}` }}>
                    <p className="font-bold text-ink">{f.p.nombre}</p>
                    <p style={{ color: C.dim }}>
                      Costo {formatMXN2(f.antes)} → <b style={{ color: C.ink }}>{formatMXN2(f.despues)}</b> ·
                      margen WhatsApp {f.mAntes ? pct(f.mAntes.pct) : '—'} → <b style={{ color: f.mDespues && f.mDespues.pct < f.mAntes?.pct ? C.bad : C.ink }}>{f.mDespues ? pct(f.mDespues.pct) : '—'}</b>
                    </p>
                  </div>
                ))}
                <p className="text-sm font-bold" style={{ color: imp.totalMes > 0 ? C.bad : C.ok }}>
                  {imp.totalMes > 0 ? `≈ ${formatMXN(imp.totalMes)} menos de utilidad al mes` : imp.totalMes < 0 ? `≈ ${formatMXN(-imp.totalMes)} más de utilidad al mes` : 'Sin efecto en la utilidad con tus ventas recientes'}
                </p>
                {volumen.desde && <p className="text-xs" style={{ color: C.dimmer }}>Con lo que vendiste del {formatDiaCorto(String(volumen.desde))} al {formatDiaCorto(String(volumen.hasta))}.</p>}
              </>
            )}
          </div>
        )}

        <p className="text-xs" style={{ color: C.dimmer }}>
          Tu siguiente compra registrada vuelve a calcular el costo promedio. Este cambio sirve para reflejar el aumento desde hoy.
        </p>
        <BotonPrincipal onClick={() => onAplicar(nuevo)} disabled={nuevo == null}>Agregar al lote</BotonPrincipal>
        <BotonSecundario peligro onClick={onDesactivar}>Desactivar insumo (no se borra)</BotonSecundario>
      </main>
    </div>
  );
}

// ── Ajuste masivo ──
function AjusteMasivo({ productos, insumos, cfg, valor, costoProducto, costoInsumo, impacto, volumen, onAplicarPrecios, onAplicarCosto }) {
  const [pctP,  setPctP]  = useState('5');
  const [cat,   setCat]   = useState('todas');
  const [canal, setCanal] = useState('todos');
  const [ins,   setIns]   = useState(null);
  const [pctI,  setPctI]  = useState('');

  const vista = productos
    .filter((p) => cat === 'todas' || (p.categoria || 'burger') === cat)
    .flatMap((p) => CANALES_PRECIO.filter((ch) => canal === 'todos' || ch.key === canal).map((ch) => {
      const antes = valor(p, ch.campo);
      if (antes == null || !(n(pctP) > 0)) return null;
      const nuevo = subirPrecio(antes, pctP);
      const costo = costoProducto(p);
      return { p, campo: ch.campo, canal: ch, antes: n(antes), nuevo, m: margenCanal(nuevo, costo, ch.key, cfg) };
    }).filter(Boolean));

  const nuevoCosto = ins && n(pctI) ? costoInsumo(ins.id) * (1 + n(pctI) / 100) : null;
  const imp = nuevoCosto != null ? impacto({ [ins.id]: nuevoCosto }) : null;

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <p className="font-display text-lg" style={{ color: C.ink, fontWeight: 600 }}>Subir precios</p>
        <CantidadInput value={pctP} onChange={setPctP} unidad="%" />
        <Chips options={[{ key: 'todas', label: 'Todo' }, ...CATEGORIAS_PRODUCTO]} value={cat} onChange={setCat} wrap />
        <Chips options={[{ key: 'todos', label: 'Todos' }, ...CANALES_PRECIO.map((c) => ({ key: c.key, label: c.label }))]} value={canal} onChange={setCanal} />
        {vista.length > 0 && (
          <div className="rounded-card overflow-hidden" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs" style={{ color: C.dim }}>
                <th className="px-3 py-2 font-normal">Producto</th><th className="font-normal text-right">Antes</th><th className="font-normal text-right">Después</th><th className="font-normal text-right pr-3">Margen</th>
              </tr></thead>
              <tbody>
                {vista.map((v) => (
                  <tr key={`${v.p.id}-${v.campo}`} style={{ borderTop: `1px solid ${C.border}` }}>
                    <td className="px-3 py-2" style={{ color: C.ink }}>{v.p.nombre}<span className="block text-xs" style={{ color: C.dim }}>{v.canal.label}</span></td>
                    <td className="text-right" style={{ color: C.dim }}>{formatMXN(v.antes)}</td>
                    <td className="text-right font-bold" style={{ color: C.ink }}>{formatMXN(v.nuevo)}</td>
                    <td className="text-right pr-3"><ChipMargen m={v.m} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <BotonPrincipal disabled={!vista.length} onClick={() => onAplicarPrecios(vista)}>Agregar {vista.length} precios al lote</BotonPrincipal>
      </section>

      <section className="space-y-3">
        <p className="font-display text-lg" style={{ color: C.ink, fontWeight: 600 }}>Subió un insumo</p>
        {!ins ? (
          <BuscadorInsumos insumos={insumos} permitirCrear={false} onElegir={setIns} placeholder="¿Qué insumo subió?" />
        ) : (
          <>
            <div className="flex items-center justify-between rounded-xl px-4" style={{ background: C.surface, border: `1px solid ${C.border}`, minHeight: 52 }}>
              <span className="font-bold text-ink">{ins.nombre}</span>
              <button type="button" onClick={() => setIns(null)} className="px-3 rounded-full text-sm" style={{ border: `1px solid ${C.border}`, color: C.ink, minHeight: 44 }}>Cambiar</button>
            </div>
            <CantidadInput value={pctI} onChange={setPctI} unidad="%" autoFocus />
            {imp && (
              <div className="rounded-card p-3 text-sm space-y-1" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
                <p style={{ color: C.dim }}>
                  {formatMXN2(costoGrande(costoInsumo(ins.id), ins.unidad_base))} → <b style={{ color: C.ink }}>{formatMXN2(costoGrande(nuevoCosto, ins.unidad_base))}</b> por {UNIDAD_GRANDE[ins.unidad_base].label}
                </p>
                {imp.filas.map((f) => (
                  <p key={f.p.id} style={{ color: C.dim }}>
                    {f.p.nombre}: {formatMXN2(f.antes)} → <b style={{ color: C.ink }}>{formatMXN2(f.despues)}</b> · margen {f.mAntes ? pct(f.mAntes.pct) : '—'} → {f.mDespues ? pct(f.mDespues.pct) : '—'}
                  </p>
                ))}
                <p className="font-bold" style={{ color: C.bad }}>≈ {formatMXN(imp.totalMes)} menos de utilidad al mes</p>
                {volumen.desde && <p className="text-xs" style={{ color: C.dimmer }}>Con lo que vendiste del {formatDiaCorto(String(volumen.desde))} al {formatDiaCorto(String(volumen.hasta))}.</p>}
              </div>
            )}
            <BotonPrincipal disabled={nuevoCosto == null} onClick={() => { onAplicarCosto(ins.id, nuevoCosto); setIns(null); setPctI(''); }}>Agregar al lote</BotonPrincipal>
          </>
        )}
      </section>
    </div>
  );
}

// ── Historial de cambios ──
function Historial({ historial }) {
  const [filtro, setFiltro] = useState('todo');
  const [texto,  setTexto]  = useState('');
  const lista = historial
    .filter((h) => filtro === 'todo' || h.tipo === filtro)
    .filter((h) => !texto.trim() || (h.nombre || '').toLowerCase().includes(texto.trim().toLowerCase()))
    .slice(0, 80);
  return (
    <div className="space-y-3">
      <Chips options={[{ key: 'todo', label: 'Todo' }, { key: 'precio', label: 'Precios' }, { key: 'costo', label: 'Costos' }]} value={filtro} onChange={setFiltro} />
      <TextInput value={texto} onChange={setTexto} placeholder="Filtrar por producto o insumo" />
      {lista.length === 0 ? <p className="text-sm" style={{ color: C.dim }}>Sin cambios registrados.</p> : lista.map((h) => (
        <div key={`${h.tipo}-${h.id}`} className="rounded-xl px-4 py-2" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
          <div className="flex items-center justify-between gap-2">
            <span className="font-bold text-ink text-sm truncate">{h.nombre}</span>
            <span className="text-xs shrink-0" style={{ color: C.dimmer }}>{new Date(h.created_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', timeZone: 'America/Mazatlan' })}</span>
          </div>
          <p className="text-sm" style={{ color: C.dim }}>
            {h.tipo === 'precio'
              ? `${CAMPOS[h.campo] || h.campo}: ${h.valor_anterior == null ? '—' : formatMXN2(n(h.valor_anterior))} → ${formatMXN2(n(h.valor_nuevo))}`
              : `Costo por ${UNIDAD_GRANDE[h.unidad]?.label || h.unidad}: ${h.costo_anterior == null ? '—' : formatMXN2(costoGrande(h.costo_anterior, h.unidad))} → ${formatMXN2(costoGrande(h.costo_nuevo, h.unidad))} · ${h.origen === 'compra' ? 'por compra' : 'manual'}`}
          </p>
          {h.motivo && <p className="text-xs" style={{ color: C.dimmer }}>{h.motivo}</p>}
        </div>
      ))}
    </div>
  );
}
