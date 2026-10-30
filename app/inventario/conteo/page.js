'use client';
// Conteo de inventario en una pantalla: insumo por insumo con input grande y "Siguiente".
// Es un conteo a ciegas (no muestra lo que "debería" haber) para no sesgar. Al final, resumen
// valorizado de diferencias y "Cerrar conteo" (registra el ajuste: merma o sobrante).
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { Label, Cargando, Vacio, BotonPrincipal, CantidadInput, C } from '@/components/ui';
import { supabase } from '@/lib/supabase/client';
import { formatMXN, formatMXN2 } from '@/lib/calculos';
import { NEGOCIO_ID, vibrar, msgError } from '@/lib/negocio';
import { CATEGORIAS_INSUMO, NOMBRE_CATEGORIA, UNIDAD_GRANDE, fmtCantidad, aGrande, deGrande } from '@/lib/inventario';
import { formatFechaHora } from '@/lib/dia';

const ORDEN_CAT = Object.fromEntries(CATEGORIAS_INSUMO.map((c, i) => [c.key, i]));

export default function ConteoPage() {
  const router = useRouter();
  const [cargando,  setCargando]  = useState(true);
  const [insumos,   setInsumos]   = useState([]);
  const [conteo,    setConteo]    = useState(null);
  const [contados,  setContados]  = useState({});   // insumo_id → cantidad física (base)
  const [idx,       setIdx]       = useState(0);
  const [valor,     setValor]     = useState('');
  const [resumen,   setResumen]   = useState(null);
  const [cerrado,   setCerrado]   = useState(null);
  const [ocupado,   setOcupado]   = useState(false);
  const inputRef = useRef(null);

  const cargar = useCallback(async () => {
    const [{ data: ins }, { data: abiertos }] = await Promise.all([
      supabase.from('insumos').select('id, nombre, categoria, unidad_base')
        .eq('negocio_id', NEGOCIO_ID).eq('activo', true),
      supabase.from('conteos_inventario').select('*').eq('negocio_id', NEGOCIO_ID).eq('cerrado', false).limit(1),
    ]);
    const ordenados = (ins || []).sort((a, b) =>
      (ORDEN_CAT[a.categoria] - ORDEN_CAT[b.categoria]) || a.nombre.localeCompare(b.nombre));
    setInsumos(ordenados);
    const c = abiertos?.[0] || null;
    setConteo(c);
    if (c) {
      const { data: its } = await supabase.from('conteo_items').select('insumo_id, cantidad_fisica').eq('conteo_id', c.id);
      const m = Object.fromEntries((its || []).map((i) => [i.insumo_id, Number(i.cantidad_fisica)]));
      setContados(m);
      const primero = ordenados.findIndex((i) => !(i.id in m));
      setIdx(primero === -1 ? ordenados.length : primero);
    }
    setCargando(false);
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const actual = insumos[idx];
  // Al cambiar de insumo, precarga lo ya contado (si regresó) y enfoca el input
  useEffect(() => {
    if (!actual) return;
    setValor(actual.id in contados ? String(aGrande(contados[actual.id], actual.unidad_base)) : '');
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [idx, actual?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (conteo && idx >= insumos.length && insumos.length) {
      supabase.rpc('resumen_conteo', { p_conteo: conteo.id }).then(({ data }) => setResumen(data || []));
    } else {
      setResumen(null);
    }
  }, [idx, conteo, insumos.length]);

  const empezar = async () => {
    setOcupado(true);
    const { data, error } = await supabase.from('conteos_inventario')
      .insert({ negocio_id: NEGOCIO_ID }).select().single();
    setOcupado(false);
    if (error) { alert(msgError(error)); return; }
    vibrar();
    setConteo(data);
    setContados({});
    setIdx(0);
  };

  const siguiente = async () => {
    if (valor === '' || Number(valor) < 0) return;
    const base = deGrande(valor, actual.unidad_base);
    setOcupado(true);
    const { error } = await supabase.from('conteo_items').upsert({
      negocio_id: NEGOCIO_ID, conteo_id: conteo.id, insumo_id: actual.id, cantidad_fisica: base,
    }, { onConflict: 'conteo_id,insumo_id' });
    setOcupado(false);
    if (error) { alert(msgError(error)); return; }
    vibrar();
    setContados((p) => ({ ...p, [actual.id]: base }));
    setIdx((i) => i + 1);
  };

  const cerrar = async () => {
    setOcupado(true);
    const { data, error } = await supabase.rpc('cerrar_conteo', { p_conteo: conteo.id });
    setOcupado(false);
    if (error) { alert(msgError(error)); return; }
    vibrar();
    setCerrado(data);
  };

  const descartar = async () => {
    if (!confirm('¿Descartar este conteo? Se borra lo capturado y no se ajusta nada.')) return;
    const { error } = await supabase.from('conteos_inventario').delete().eq('id', conteo.id);
    if (error) { alert(msgError(error)); return; }
    router.push('/inventario');
  };

  const top = (titulo) => (
    <header className="sticky top-0 z-40 flex items-center gap-3 px-4 py-3"
      style={{ background: C.bg, borderBottom: `1px solid ${C.surface2}` }}>
      <Link href="/inventario" aria-label="Volver" className="flex items-center justify-center rounded-xl"
        style={{ width: 48, height: 48, background: C.surface2 }}>
        <ChevronLeft size={22} style={{ color: C.dim }} />
      </Link>
      <p className="font-bold text-white text-lg">{titulo}</p>
    </header>
  );

  const shell = (titulo, children) => (
    <div className="flex flex-col min-h-screen" style={{ background: C.bg }}>
      {top(titulo)}
      <main className="flex-1 px-4 pt-4 pb-10 space-y-4">{children}</main>
    </div>
  );

  if (cargando) return shell('Conteo', <Cargando />);

  if (!insumos.length) {
    return shell('Conteo', (
      <Vacio emoji="📦" titulo="Primero da de alta tus insumos" texto="El conteo recorre tus insumos uno por uno."
        accion="Dar de alta insumos" onAccion={() => router.push('/inventario/carga')} />
    ));
  }

  // ── Conteo cerrado: resultado ──
  if (cerrado) {
    const v = Number(cerrado.valor_diferencia);
    return shell('Conteo cerrado', (
      <>
        <div className="rounded-2xl p-5 text-center space-y-1" style={{ background: C.surface }}>
          <p className="text-4xl">✅</p>
          <p className="font-bold text-white text-lg">Inventario ajustado</p>
          <p className="text-sm" style={{ color: C.dim }}>{cerrado.insumos} insumos contados</p>
          <p className="text-2xl font-bold pt-2" style={{ color: v < 0 ? C.bad : v > 0 ? C.ok : '#fff' }}>
            {v < 0 ? `Merma ${formatMXN(-v)}` : v > 0 ? `Sobrante ${formatMXN(v)}` : 'Sin diferencias'}
          </p>
          <p className="text-xs" style={{ color: C.dim }}>Inventario valorizado: {formatMXN(Number(cerrado.valor_inventario))}</p>
        </div>
        <BotonPrincipal onClick={() => router.push('/inventario')}>Volver a inventario</BotonPrincipal>
      </>
    ));
  }

  // ── Sin conteo abierto: arrancar ──
  if (!conteo) {
    return shell('Contar inventario', (
      <>
        <div className="rounded-2xl p-5 space-y-2" style={{ background: C.surface }}>
          <p className="font-bold text-white">Cuenta lo que hay físicamente</p>
          <p className="text-sm" style={{ color: C.dim }}>
            Vas a ver {insumos.length} insumos uno por uno. Escribe lo que cuentas (en kg, L o piezas) y toca Siguiente.
            Al final te mostramos la diferencia contra lo que debería haber, en pesos.
          </p>
          <p className="text-xs" style={{ color: C.dimmer }}>Mejor antes de abrir o después de cerrar, sin ventas en curso.</p>
        </div>
        <BotonPrincipal onClick={empezar} disabled={ocupado}>Empezar conteo</BotonPrincipal>
      </>
    ));
  }

  // ── Resumen antes de cerrar ──
  if (idx >= insumos.length) {
    const total = (resumen || []).reduce((s, r) => s + Number(r.valor_diferencia), 0);
    const sinContar = insumos.filter((i) => !(i.id in contados));
    return shell('Resumen del conteo', (
      <>
        {!resumen ? <Cargando /> : (
          <>
            <div className="rounded-2xl p-4 text-center" style={{ background: C.surface }}>
              <p className="text-xs font-bold" style={{ color: C.dim }}>DIFERENCIA VALORIZADA</p>
              <p className="text-3xl font-bold" style={{ color: total < 0 ? C.bad : total > 0 ? C.ok : '#fff' }}>
                {total < 0 ? '−' : total > 0 ? '+' : ''}{formatMXN(Math.abs(total))}
              </p>
              <p className="text-xs" style={{ color: C.dim }}>
                {total < 0 ? 'Merma' : total > 0 ? 'Sobrante' : 'Sin diferencias'} · conteo de {formatFechaHora(conteo.fecha)}
              </p>
            </div>
            <div className="space-y-2">
              {resumen.map((r) => {
                const d = Number(r.diferencia);
                return (
                  <button key={r.insumo_id} type="button" onClick={() => setIdx(insumos.findIndex((i) => i.id === r.insumo_id))}
                    className="w-full flex items-center justify-between gap-2 px-4 py-2 rounded-xl text-left"
                    style={{ background: C.surface, minHeight: 56 }}>
                    <span className="min-w-0">
                      <span className="block font-bold text-white text-sm truncate">{r.nombre}</span>
                      <span className="block text-xs" style={{ color: C.dimmer }}>
                        Contaste {fmtCantidad(r.cantidad_fisica, r.unidad_base)}
                        {r.arranque ? ' · primer conteo' : ` · debía ${fmtCantidad(r.cantidad_teorica, r.unidad_base)}`}
                      </span>
                    </span>
                    {r.arranque ? (
                      <span className="px-2 py-1 rounded-lg text-xs font-bold shrink-0" style={{ background: `${C.ok}22`, color: C.ok }}>
                        Arranque
                      </span>
                    ) : (
                    <span className="text-right shrink-0">
                      <span className="block text-sm font-bold" style={{ color: d < 0 ? C.bad : d > 0 ? C.ok : C.dim }}>
                        {d > 0 ? '+' : ''}{fmtCantidad(d, r.unidad_base)}
                      </span>
                      <span className="block text-xs" style={{ color: C.dim }}>{formatMXN2(Number(r.valor_diferencia))}</span>
                    </span>
                    )}
                  </button>
                );
              })}
            </div>
            {resumen.some((r) => r.arranque) && (
              <p className="text-xs" style={{ color: C.dim }}>
                «Arranque»: primer conteo de ese insumo. Fija su stock inicial y no cuenta como merma.
              </p>
            )}
            {sinContar.length > 0 && (
              <p className="text-xs" style={{ color: C.warn }}>
                Sin contar (no se ajustan): {sinContar.map((i) => i.nombre).join(', ')}
              </p>
            )}
            <BotonPrincipal onClick={cerrar} disabled={ocupado || !resumen.length}>
              {ocupado ? 'Cerrando…' : 'Cerrar conteo'}
            </BotonPrincipal>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setIdx(0)} className="rounded-xl text-sm font-bold"
                style={{ background: C.surface2, color: C.dim, minHeight: 48 }}>Revisar desde el inicio</button>
              <button type="button" onClick={descartar} className="rounded-xl text-sm font-bold"
                style={{ background: C.surface2, color: C.bad, minHeight: 48 }}>Descartar conteo</button>
            </div>
          </>
        )}
      </>
    ));
  }

  // ── Paso: un insumo ──
  const u = UNIDAD_GRANDE[actual.unidad_base];
  return shell(`Conteo · ${idx + 1} de ${insumos.length}`, (
    <>
      <div className="h-2 rounded-full overflow-hidden" style={{ background: C.surface2 }}>
        <div className="h-full" style={{ width: `${(idx / insumos.length) * 100}%`, background: C.brand }} />
      </div>
      <div className="pt-4">
        <Label>{NOMBRE_CATEGORIA[actual.categoria]?.toUpperCase()}</Label>
        <p className="text-3xl font-bold text-white">{actual.nombre}</p>
        <p className="text-sm mt-1" style={{ color: C.dim }}>¿Cuánto hay? En {u.label === 'pza' ? 'piezas' : u.label}.</p>
      </div>
      <div ref={(el) => { inputRef.current = el?.querySelector('input'); }}>
        <CantidadInput value={valor} onChange={setValor} unidad={u.label} big onEnter={siguiente} />
      </div>
      <BotonPrincipal onClick={siguiente} disabled={valor === '' || ocupado}>Siguiente</BotonPrincipal>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0}
          className="rounded-xl text-sm font-bold" style={{ background: C.surface2, color: idx === 0 ? '#444' : C.dim, minHeight: 52 }}>
          ← Anterior
        </button>
        <button type="button" onClick={() => setIdx((i) => i + 1)} className="rounded-xl text-sm font-bold"
          style={{ background: C.surface2, color: C.dim, minHeight: 52 }}>
          No lo conté →
        </button>
      </div>
    </>
  ));
}
