'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ClipboardCheck, BookOpen, PackagePlus, Flame, Copy, Send, ShoppingBag, AlertTriangle } from 'lucide-react';
import BottomNav from '@/components/BottomNav';
import MasMenu from '@/components/MasMenu';
import BuscadorInsumos from '@/components/BuscadorInsumos';
import { Header, Label, Chips, Sheet, Cargando, BotonPrincipal, CantidadInput, TextInput, C } from '@/components/ui';
import { supabase } from '@/lib/supabase/client';
import { formatMXN, formatMXN2 } from '@/lib/calculos';
import { diaOperativo, sumarDias, formatDiaCorto } from '@/lib/dia';
import { NEGOCIO_ID, vibrar, msgError } from '@/lib/negocio';
import {
  CATEGORIAS_INSUMO, UNIDAD_GRANDE, fmtCantidad, aGrande, deGrande, costoGrande,
  textoListaCompras, copiarTexto,
} from '@/lib/inventario';

const MOTIVOS_MERMA = [
  { key: 'Se cayó',   label: 'Se cayó' },
  { key: 'Se quemó',  label: 'Se quemó' },
  { key: 'Caducó',    label: 'Caducó' },
];

const pct = (x) => (x == null ? '—' : `${(Number(x) * 100).toFixed(1)}%`);

function rangoPeriodo(periodo) {
  const hoy = diaOperativo();
  if (periodo === 'mes') return { desde: hoy.slice(0, 8) + '01', hasta: hoy };
  const dow = new Date(hoy + 'T12:00:00Z').getUTCDay(); // 0 = domingo
  return { desde: sumarDias(hoy, dow === 0 ? -6 : 1 - dow), hasta: hoy };
}

export default function InventarioPage() {
  const [cargando,    setCargando]    = useState(true);
  const [stock,       setStock]       = useState([]);
  const [config,      setConfig]      = useState(null);
  const [proveedores, setProveedores] = useState([]);
  const [sinReceta,   setSinReceta]   = useState([]);
  const [conteoAbierto, setConteoAbierto] = useState(false);
  const [periodo,     setPeriodo]     = useState('semana');
  const [fc,          setFc]          = useState(null);
  const [lista,       setLista]       = useState([]);
  const [copiado,     setCopiado]     = useState(false);
  const [detalle,     setDetalle]     = useState(null);   // insumo en edición
  const [merma,       setMerma]       = useState(null);   // { insumo } o {} para elegir

  const cargar = useCallback(async () => {
    const [st, cfg, prov, rec, cont, lc] = await Promise.all([
      supabase.from('v_stock_insumos').select('*').eq('negocio_id', NEGOCIO_ID).eq('activo', true).order('nombre'),
      supabase.from('configuracion_negocio').select('dias_reposicion_inventario, meta_food_cost').eq('negocio_id', NEGOCIO_ID).single(),
      supabase.from('proveedores').select('id, nombre').eq('activo', true).order('nombre'),
      supabase.from('v_costo_receta').select('producto_id, nombre, n_insumos, disponible').eq('negocio_id', NEGOCIO_ID).order('orden'),
      supabase.from('conteos_inventario').select('id').eq('negocio_id', NEGOCIO_ID).eq('cerrado', false),
      supabase.rpc('lista_compras', { p_negocio: NEGOCIO_ID }),   // misma regla que "dinero comprometido"
    ]);
    setLista((lc.data || []).map((x) => ({ ...x, sugerido: Number(x.sugerido), costo: Number(x.costo) })));
    setStock(st.data || []);
    setConfig(cfg.data);
    setProveedores(prov.data || []);
    setSinReceta((rec.data || []).filter((p) => p.disponible && Number(p.n_insumos) === 0));
    setConteoAbierto((cont.data || []).length > 0);
    setCargando(false);
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  useEffect(() => {
    if (!stock.length) return;
    const { desde, hasta } = rangoPeriodo(periodo);
    supabase.rpc('food_cost', { p_negocio: NEGOCIO_ID, p_desde: desde, p_hasta: hasta })
      .then(({ data }) => setFc(data));
  }, [periodo, stock.length]);

  // Insumos sin contar: su stock aún no es real (arranca con el primer conteo), no entran a totales
  const contados   = stock.filter((i) => i.contado);
  const sinContar  = stock.length - contados.length;
  const dias       = config?.dias_reposicion_inventario ?? 7;
  const valorTotal = contados.reduce((s, i) => s + Math.max(Number(i.valor) || 0, 0), 0);
  const bajos      = contados.filter((i) => i.bajo_minimo).length;

  const textoLista = () => textoListaCompras(lista, proveedores, formatDiaCorto(diaOperativo()));
  const copiar = async () => {
    if (await copiarTexto(textoLista())) { vibrar(); setCopiado(true); setTimeout(() => setCopiado(false), 2000); }
  };

  if (cargando) {
    return (
      <div className="flex flex-col min-h-screen" style={{ background: C.bg }}>
        <Header right={<MasMenu />} />
        <Cargando />
        <BottomNav />
      </div>
    );
  }

  // ── Estado guía: todavía no hay insumos ──
  if (!stock.length) {
    const pasos = [
      { n: 1, href: '/inventario/carga',   titulo: 'Da de alta tus insumos', texto: 'Carne, pan, queso, empaque… con lo que tienes hoy y su costo.' },
      { n: 2, href: '/inventario/recetas', titulo: 'Arma tus recetas',       texto: 'Cuánto lleva cada producto. Así se descuenta solo al vender.' },
      { n: 3, href: '/inventario/conteo',  titulo: 'Haz tu primer conteo',   texto: 'Cuenta lo que hay y la app te dice cuánto se mermó.' },
    ];
    return (
      <div className="flex flex-col min-h-screen" style={{ background: C.bg }}>
        <Header right={<MasMenu />} />
        <main className="flex-1 px-4 pt-4 pb-32 space-y-3">
          <div className="text-center py-2">
            <p className="text-4xl">📦</p>
            <p className="font-bold text-white text-lg mt-2">Arranca tu inventario</p>
            <p className="text-sm" style={{ color: C.dim }}>1. Da de alta tus insumos → 2. Arma tus recetas → 3. Haz tu primer conteo</p>
          </div>
          {pasos.map((p) => (
            <Link key={p.n} href={p.href} className="flex items-center gap-3 px-4 py-3 rounded-2xl"
              style={{ background: C.surface, border: `1px solid ${p.n === 1 ? C.brand : C.border}`, minHeight: 72 }}>
              <span className="flex items-center justify-center rounded-full font-bold shrink-0"
                style={{ width: 40, height: 40, background: p.n === 1 ? C.brand : C.surface2, color: '#fff' }}>{p.n}</span>
              <span className="min-w-0">
                <span className="block font-bold text-white">{p.titulo}</span>
                <span className="block text-xs" style={{ color: C.dim }}>{p.texto}</span>
              </span>
            </Link>
          ))}
          <Link href="/insumos" className="flex items-center justify-center gap-2 rounded-2xl font-bold"
            style={{ background: C.surface2, color: C.dim, minHeight: 52 }}>
            <ShoppingBag size={18} /> Registrar compra de insumos
          </Link>
        </main>
        <BottomNav />
      </div>
    );
  }

  const porCategoria = CATEGORIAS_INSUMO
    .map((c) => ({ ...c, items: stock.filter((i) => i.categoria === c.key) }))
    .filter((c) => c.items.length);

  const meta = Number(fc?.meta ?? config?.meta_food_cost ?? 0.32);
  const colorFc = (x) => (x == null ? C.dim : Number(x) <= meta ? C.ok : Number(x) <= meta + 0.03 ? C.warn : C.bad);

  return (
    <div className="flex flex-col min-h-screen" style={{ background: C.bg }}>
      <Header right={<MasMenu />} />
      <main className="flex-1 px-4 pt-4 pb-32 space-y-4">

        {/* ── Resumen ── */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-2xl px-4 py-3" style={{ background: C.surface }}>
            <p className="text-xs font-bold" style={{ color: C.dim }}>VALOR INVENTARIO</p>
            <p className="text-xl font-bold text-white">{formatMXN(valorTotal)}</p>
          </div>
          <div className="rounded-2xl px-4 py-3" style={{ background: bajos ? `${C.bad}1a` : C.surface, border: bajos ? `1px solid ${C.bad}66` : 'none' }}>
            <p className="text-xs font-bold" style={{ color: bajos ? C.bad : C.dim }}>BAJO MÍNIMO</p>
            <p className="text-xl font-bold" style={{ color: bajos ? C.bad : '#fff' }}>{bajos}</p>
          </div>
        </div>

        <Link href="/inventario/conteo" className="flex items-center justify-center gap-2 rounded-2xl font-bold text-lg"
          style={{ background: C.brand, color: '#fff', minHeight: 60 }}>
          <ClipboardCheck size={22} /> {conteoAbierto ? 'Continuar conteo' : 'Contar inventario'}
        </Link>
        {sinContar > 0 && (
          <p className="text-xs text-center -mt-2" style={{ color: C.warn }}>
            {sinContar === stock.length
              ? 'Tu stock arranca con el primer conteo: cuenta lo que tienes hoy.'
              : `${sinContar} insumo(s) sin contar todavía: no entran al valor ni a la lista de compras.`}
          </p>
        )}

        <div className="grid grid-cols-3 gap-2">
          {[
            { onClick: () => setMerma({}), icon: Flame, label: 'Merma' },
            { href: '/inventario/recetas', icon: BookOpen, label: 'Recetas' },
            { href: '/inventario/carga', icon: PackagePlus, label: 'Alta insumos' },
          ].map(({ href, onClick, icon: Icon, label }) => {
            const cls = 'flex flex-col items-center justify-center gap-1 rounded-2xl text-xs font-bold';
            const st = { background: C.surface, color: '#ddd', minHeight: 64 };
            return href
              ? <Link key={label} href={href} className={cls} style={st}><Icon size={20} style={{ color: C.brand }} />{label}</Link>
              : <button key={label} type="button" onClick={onClick} className={cls} style={st}><Icon size={20} style={{ color: C.brand }} />{label}</button>;
          })}
        </div>

        {/* ── Productos sin receta ── */}
        {sinReceta.length > 0 && (
          <Link href="/inventario/recetas" className="block rounded-2xl px-4 py-3"
            style={{ background: `${C.warn}14`, border: `1px solid ${C.warn}55` }}>
            <p className="flex items-center gap-2 font-bold text-sm" style={{ color: C.warn }}>
              <AlertTriangle size={16} /> Productos sin receta ({sinReceta.length})
            </p>
            <p className="text-xs mt-1" style={{ color: C.dim }}>
              {sinReceta.map((p) => p.nombre).join(', ')}. No descuentan inventario; su costo sale del costo registrado.
            </p>
          </Link>
        )}

        {/* ── Food cost ── */}
        <div className="rounded-2xl p-4 space-y-3" style={{ background: C.surface }}>
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold" style={{ color: C.dim }}>FOOD COST</p>
            <p className="text-xs" style={{ color: C.dimmer }}>meta {pct(meta)}</p>
          </div>
          <Chips options={[{ key: 'semana', label: 'Esta semana' }, { key: 'mes', label: 'Este mes' }]}
            value={periodo} onChange={setPeriodo} />
          {!fc ? <p className="text-sm" style={{ color: C.dim }}>Calculando…</p>
            : Number(fc.venta_neta) === 0 ? (
              <p className="text-sm" style={{ color: C.dim }}>Aún no hay ventas registradas en este periodo.</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <p className="text-xs" style={{ color: C.dim }}>Teórico (recetas)</p>
                    <p className="text-2xl font-bold" style={{ color: colorFc(fc.fc_teorico) }}>{pct(fc.fc_teorico)}</p>
                  </div>
                  <div>
                    <p className="text-xs" style={{ color: C.dim }}>Real{fc.estimado ? ' (estimado)' : ''}</p>
                    <p className="text-2xl font-bold" style={{ color: colorFc(fc.fc_real) }}>{pct(fc.fc_real)}</p>
                  </div>
                </div>
                <div className="text-xs space-y-1" style={{ color: C.dim }}>
                  <p>Venta neta {formatMXN(Number(fc.venta_neta))} · costo teórico {formatMXN(Number(fc.costo_teorico))}</p>
                  <p>Mermas y ajustes {formatMXN(Number(fc.mermas))}</p>
                  {Number(fc.respaldo_sin_receta) > 0 && (
                    <p>Incluye {formatMXN(Number(fc.respaldo_sin_receta))} de productos sin receta (costo registrado).</p>
                  )}
                  {fc.estimado
                    ? <p>Real = teórico + mermas. Para el real exacto cuenta al inicio y al final del periodo.</p>
                    : <p>Real = inv. inicial {formatMXN(Number(fc.inventario_inicial))} + compras {formatMXN(Number(fc.compras))} − inv. final {formatMXN(Number(fc.inventario_final))}</p>}
                </div>
              </>
            )}
        </div>

        {/* ── Lista de compras ── */}
        <div className="rounded-2xl p-4 space-y-3" style={{ background: C.surface }}>
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold" style={{ color: C.dim }}>LISTA DE COMPRAS</p>
            <p className="text-xs" style={{ color: C.dimmer }}>para {dias} días</p>
          </div>
          {lista.length === 0 ? (
            <p className="text-sm" style={{ color: C.dim }}>Nada urgente: todo está arriba del mínimo y cubre más de {dias} días.</p>
          ) : (
            <>
              {lista.map((s) => (
                <div key={s.insumo_id} className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-white truncate">{s.nombre}</p>
                    <p className="text-xs" style={{ color: s.bajo_minimo ? C.bad : C.warn }}>
                      {s.bajo_minimo ? 'Bajo mínimo' : `Alcanza ≈ ${Number(s.dias_cobertura)} días`} · hay {fmtCantidad(s.stock, s.unidad_base)}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-white">{fmtCantidad(s.sugerido, s.unidad_base)}</p>
                    <p className="text-xs" style={{ color: C.dim }}>≈ {formatMXN(s.costo)}</p>
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between pt-2" style={{ borderTop: `1px solid ${C.border}` }}>
                <p className="text-xs font-bold" style={{ color: C.dim }}>COSTO ESTIMADO</p>
                <p className="font-bold text-white">{formatMXN(lista.reduce((s, i) => s + i.costo, 0))}</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={copiar} className="flex items-center justify-center gap-2 rounded-xl font-bold text-sm"
                  style={{ background: copiado ? C.ok : C.surface2, color: '#fff', minHeight: 52 }}>
                  <Copy size={16} /> {copiado ? '¡Copiada!' : 'Copiar'}
                </button>
                <a href={`https://wa.me/?text=${encodeURIComponent(textoLista())}`} target="_blank" rel="noreferrer"
                  className="flex items-center justify-center gap-2 rounded-xl font-bold text-sm"
                  style={{ background: '#25D366', color: '#fff', minHeight: 52 }}>
                  <Send size={16} /> WhatsApp
                </a>
              </div>
            </>
          )}
        </div>

        {/* ── Existencias por categoría ── */}
        {porCategoria.map((cat) => (
          <div key={cat.key}>
            <Label>{cat.label.toUpperCase()}</Label>
            <div className="space-y-2">
              {cat.items.map((i) => (
                <button key={i.insumo_id} type="button" onClick={() => setDetalle(i)}
                  className="w-full flex items-center justify-between gap-2 px-4 rounded-xl text-left"
                  style={{ background: C.surface, minHeight: 56, border: i.bajo_minimo ? `1px solid ${C.bad}66` : 'none' }}>
                  <span className="min-w-0">
                    <span className="block font-bold text-white truncate">{i.nombre}</span>
                    <span className="block text-xs" style={{ color: C.dimmer }}>
                      {!i.contado ? 'sin contar' : i.dias_cobertura != null ? `≈ ${Number(i.dias_cobertura)} días` : 'sin consumo aún'}
                      {Number(i.costo_promedio) > 0 && ` · ${formatMXN2(costoGrande(i.costo_promedio, i.unidad_base))}/${UNIDAD_GRANDE[i.unidad_base].label}`}
                    </span>
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    {i.contado && i.bajo_minimo && (
                      <span className="px-2 py-1 rounded-lg text-xs font-bold" style={{ background: `${C.bad}22`, color: C.bad }}>Bajo</span>
                    )}
                    <span className="font-bold" style={{ color: !i.contado ? C.dimmer : Number(i.stock) < 0 ? C.bad : '#fff' }}>
                      {i.contado ? fmtCantidad(i.stock, i.unidad_base) : '—'}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </main>

      {detalle && (
        <DetalleInsumo insumo={detalle} proveedores={proveedores} onClose={() => setDetalle(null)}
          onMerma={() => { setMerma({ insumo: detalle }); setDetalle(null); }}
          onGuardado={() => { setDetalle(null); cargar(); }} />
      )}
      {merma && (
        <MermaSheet inicial={merma.insumo} insumos={stock} onClose={() => setMerma(null)}
          onGuardado={() => { setMerma(null); cargar(); }} />
      )}
      <BottomNav />
    </div>
  );
}

// ── Editar insumo: mínimo, categoría, proveedor, baja ──
function DetalleInsumo({ insumo, proveedores, onClose, onMerma, onGuardado }) {
  const u = UNIDAD_GRANDE[insumo.unidad_base];
  const [minimo,    setMinimo]    = useState(Number(insumo.stock_minimo) ? String(aGrande(insumo.stock_minimo, insumo.unidad_base)) : '');
  const [categoria, setCategoria] = useState(insumo.categoria);
  const [proveedor, setProveedor] = useState(insumo.proveedor_id);
  const [guardando, setGuardando] = useState(false);

  const guardar = async (extra = {}) => {
    setGuardando(true);
    const { error } = await supabase.from('insumos').update({
      stock_minimo: deGrande(minimo, insumo.unidad_base), categoria, proveedor_id: proveedor, ...extra,
    }).eq('id', insumo.insumo_id);
    setGuardando(false);
    if (error) { alert(msgError(error)); return; }
    vibrar();
    onGuardado();
  };

  return (
    <Sheet open title={insumo.nombre} onClose={onClose}>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl px-3 py-2" style={{ background: C.surface }}>
          <p className="text-xs" style={{ color: C.dim }}>Hay</p>
          <p className="font-bold text-white">{insumo.contado ? fmtCantidad(insumo.stock, insumo.unidad_base) : 'Sin contar'}</p>
        </div>
        <div className="rounded-xl px-3 py-2" style={{ background: C.surface }}>
          <p className="text-xs" style={{ color: C.dim }}>Costo</p>
          <p className="font-bold text-white">
            {formatMXN2(costoGrande(insumo.costo_promedio, insumo.unidad_base))}/{UNIDAD_GRANDE[insumo.unidad_base].label}
          </p>
          <p className="text-xs" style={{ color: C.dimmer }}>{insumo.costo_origen === 'compras' ? 'de tus compras' : 'de referencia'}</p>
        </div>
      </div>
      <button type="button" onClick={onMerma} className="w-full flex items-center justify-center gap-2 rounded-xl font-bold"
        style={{ background: `${C.bad}22`, color: C.bad, minHeight: 52 }}>
        <Flame size={18} /> Registrar merma
      </button>
      <div>
        <Label>AVÍSAME CUANDO QUEDE MENOS DE</Label>
        <CantidadInput value={minimo} onChange={setMinimo} unidad={u.label} />
      </div>
      <div>
        <Label>CATEGORÍA</Label>
        <Chips options={CATEGORIAS_INSUMO} value={categoria} onChange={setCategoria} wrap />
      </div>
      {proveedores.length > 0 && (
        <div>
          <Label>PROVEEDOR</Label>
          <Chips options={[{ key: null, label: 'Ninguno' }, ...proveedores.map((p) => ({ key: p.id, label: p.nombre }))]}
            value={proveedor} onChange={setProveedor} wrap />
        </div>
      )}
      <BotonPrincipal onClick={() => guardar()} disabled={guardando}>Guardar</BotonPrincipal>
      <button type="button" onClick={() => { if (confirm(`¿Dar de baja "${insumo.nombre}"? Deja de aparecer en listas y conteos.`)) guardar({ activo: false }); }}
        className="w-full rounded-xl text-sm font-bold" style={{ background: C.surface2, color: C.dim, minHeight: 48 }}>
        Dar de baja
      </button>
    </Sheet>
  );
}

// ── Registrar merma directa (se cayó, se quemó, caducó) ──
function MermaSheet({ inicial, insumos, onClose, onGuardado }) {
  const [insumo,    setInsumo]    = useState(inicial || null);
  const [enGrande,  setEnGrande]  = useState(false);
  const [cantidad,  setCantidad]  = useState('');
  const [motivo,    setMotivo]    = useState(null);
  const [otro,      setOtro]      = useState('');
  const [guardando, setGuardando] = useState(false);

  const lista = insumos.map((i) => ({ ...i, id: i.insumo_id }));
  const unidad = insumo ? (enGrande ? UNIDAD_GRANDE[insumo.unidad_base].label : insumo.unidad_base) : '';
  const base = insumo ? (enGrande ? deGrande(cantidad, insumo.unidad_base) : Number(cantidad)) : 0;

  const guardar = async () => {
    if (!insumo || !(base > 0)) return;
    setGuardando(true);
    const { error } = await supabase.from('inventario_movimientos').insert({
      negocio_id: NEGOCIO_ID,
      insumo_id:  insumo.insumo_id,
      tipo:       'merma',
      cantidad:   -base,
      motivo:     (motivo === 'otro' ? otro.trim() : motivo) || 'Merma',
    });
    setGuardando(false);
    if (error) { alert(msgError(error)); return; }
    vibrar();
    onGuardado();
  };

  return (
    <Sheet open title="Registrar merma" onClose={onClose}>
      {!insumo ? (
        <div>
          <Label>¿QUÉ SE PERDIÓ?</Label>
          <BuscadorInsumos insumos={lista} recientes={lista.slice(0, 8)} permitirCrear={false}
            onElegir={(i) => setInsumo(lista.find((x) => x.id === i.id))} />
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between rounded-xl px-4" style={{ background: C.surface, minHeight: 52 }}>
            <p className="font-bold text-white">{insumo.nombre}</p>
            {!inicial && (
              <button type="button" onClick={() => setInsumo(null)} className="text-sm px-3 rounded-xl"
                style={{ background: C.surface2, color: C.dim, minHeight: 44 }}>Cambiar</button>
            )}
          </div>
          {insumo.unidad_base !== 'pza' && (
            <Chips options={[{ key: false, label: insumo.unidad_base }, { key: true, label: UNIDAD_GRANDE[insumo.unidad_base].label }]}
              value={enGrande} onChange={setEnGrande} />
          )}
          <div>
            <Label>CANTIDAD</Label>
            <CantidadInput value={cantidad} onChange={setCantidad} unidad={unidad} autoFocus />
            {base > 0 && Number(insumo.costo_promedio) > 0 && (
              <p className="text-xs mt-1" style={{ color: C.bad }}>
                ≈ {formatMXN2(base * Number(insumo.costo_promedio))} perdidos
              </p>
            )}
          </div>
          <div>
            <Label>MOTIVO (OPCIONAL)</Label>
            <Chips options={[...MOTIVOS_MERMA, { key: 'otro', label: 'Otro' }]} value={motivo}
              onChange={(k) => setMotivo(motivo === k ? null : k)} wrap />
            {motivo === 'otro' && <div className="mt-2"><TextInput value={otro} onChange={setOtro} placeholder="¿Qué pasó?" /></div>}
          </div>
          <BotonPrincipal onClick={guardar} disabled={!(base > 0) || guardando} color={C.bad}>
            {guardando ? 'Guardando…' : 'Registrar merma'}
          </BotonPrincipal>
        </>
      )}
    </Sheet>
  );
}
