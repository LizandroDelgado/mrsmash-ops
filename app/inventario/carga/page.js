'use client';
// Carga inicial en lote: varios insumos con su stock de hoy y costo, en una sola pantalla.
// Todo se guarda en una transacción (RPC carga_inicial): insumos + movimientos 'inicial'.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft, X, Plus } from 'lucide-react';
import { Label, Chips, MontoInput, CantidadInput, TextInput, BotonPrincipal, C, Header } from '@/components/ui';
import { supabase } from '@/lib/supabase/client';
import { formatMXN } from '@/lib/calculos';
import { NEGOCIO_ID, vibrar, msgError } from '@/lib/negocio';
import { CATEGORIAS_INSUMO, UNIDADES_ALTA, UNIDAD_GRANDE, deGrande } from '@/lib/inventario';

let sec = 0;
const filaVacia = () => ({ key: ++sec, nombre: '', categoria: 'otro', unidad: 'g', stock: '', costo: '', minimo: '' });

export default function CargaInicialPage() {
  const router = useRouter();
  const [filas,     setFilas]     = useState([filaVacia()]);
  const [existentes, setExistentes] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const [hecho,     setHecho]     = useState(null);

  useEffect(() => {
    supabase.from('insumos').select('nombre').eq('negocio_id', NEGOCIO_ID).eq('activo', true)
      .then(({ data }) => setExistentes((data || []).map((i) => i.nombre.toLowerCase().trim())));
  }, []);

  const cambiar = (key, campo, valor) => setFilas((p) => p.map((f) => (f.key === key ? { ...f, [campo]: valor } : f)));
  const quitar  = (key) => setFilas((p) => (p.length > 1 ? p.filter((f) => f.key !== key) : [filaVacia()]));
  const agregarFila = () => {
    setFilas((p) => [...p, filaVacia()]);
    setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }), 50);
  };

  const llenas  = filas.filter((f) => f.nombre.trim());
  const nombres = llenas.map((f) => f.nombre.toLowerCase().trim());
  const repetido = (f) => {
    const n = f.nombre.toLowerCase().trim();
    return n && (existentes.includes(n) || nombres.filter((x) => x === n).length > 1);
  };
  const valor = llenas.reduce((s, f) => s + (Number(f.stock) || 0) * (Number(f.costo) || 0), 0);
  const puede = llenas.length > 0 && !llenas.some(repetido);

  const guardar = async () => {
    if (!puede) return;
    setGuardando(true);
    const items = llenas.map((f) => ({
      nombre:         f.nombre.trim(),
      categoria:      f.categoria,
      unidad_base:    f.unidad,
      stock:          deGrande(f.stock, f.unidad),
      costo_unitario: (Number(f.costo) || 0) / UNIDAD_GRANDE[f.unidad].factor,
      stock_minimo:   deGrande(f.minimo, f.unidad),
    }));
    const { data, error } = await supabase.rpc('carga_inicial', { p_negocio: NEGOCIO_ID, p_items: items });
    setGuardando(false);
    if (error) { alert(msgError(error)); return; }
    vibrar();
    setHecho(data);
  };

  const header = <Header titulo="Alta de insumos" back="/inventario" />;

  if (hecho) {
    return (
      <div className="min-h-screen" style={{ background: C.bg }}>
        {header}
        <main className="px-4 pt-4 pb-10 space-y-3">
          <div className="rounded-2xl p-5 text-center space-y-1" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
            <p className="text-4xl">✅</p>
            <p className="font-bold text-ink text-lg">{hecho.insumos} insumos dados de alta</p>
            <p className="text-sm" style={{ color: C.dim }}>Inventario valorizado: {formatMXN(Number(hecho.valor_inventario))}</p>
          </div>
          <BotonPrincipal onClick={() => router.push('/inventario/recetas')}>Siguiente: arma tus recetas</BotonPrincipal>
          <button type="button" onClick={() => { setHecho(null); setFilas([filaVacia()]); }}
            className="w-full rounded-2xl font-bold" style={{ background: C.surface2, color: C.dim, minHeight: 52 }}>
            Dar de alta más
          </button>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: C.bg }}>
      {header}
      <main className="px-4 pt-4 pb-40 space-y-4">
        <p className="text-sm" style={{ color: C.dim }}>
          Escribe lo que tienes hoy y cuánto te cuesta. El stock y el costo van en kg, litros o piezas.
          {existentes.length > 0 && ` Ya tienes ${existentes.length} insumos.`}
        </p>

        {filas.map((f, n) => {
          const u = UNIDAD_GRANDE[f.unidad].label;
          return (
            <div key={f.key} className="rounded-2xl p-3 space-y-3" style={{ background: C.surface, border: `1px solid ${repetido(f) ? C.bad : C.border}` }}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold shrink-0" style={{ color: C.brandText }}>{n + 1}</span>
                <div className="flex-1"><TextInput value={f.nombre} onChange={(v) => cambiar(f.key, 'nombre', v)} placeholder="Nombre (ej. Carne molida)" /></div>
                <button type="button" onClick={() => quitar(f.key)} aria-label="Quitar"
                  className="flex items-center justify-center rounded-full shrink-0" style={{ width: 48, height: 48, background: C.surface2 }}>
                  <X size={18} style={{ color: C.dimmer }} />
                </button>
              </div>
              {repetido(f) && <p className="text-xs" style={{ color: C.bad }}>Ya existe un insumo con ese nombre</p>}
              <Chips options={UNIDADES_ALTA} value={f.unidad} onChange={(v) => cambiar(f.key, 'unidad', v)} />
              <Chips options={CATEGORIAS_INSUMO} value={f.categoria} onChange={(v) => cambiar(f.key, 'categoria', v)} wrap />
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>HAY HOY</Label>
                  <CantidadInput value={f.stock} onChange={(v) => cambiar(f.key, 'stock', v)} unidad={u} />
                </div>
                <div>
                  <Label>COSTO POR {u.toUpperCase()}</Label>
                  <MontoInput value={f.costo} onChange={(v) => cambiar(f.key, 'costo', v)} />
                </div>
              </div>
              <div>
                <Label>AVÍSAME SI BAJA DE (OPCIONAL)</Label>
                <CantidadInput value={f.minimo} onChange={(v) => cambiar(f.key, 'minimo', v)} unidad={u} />
              </div>
            </div>
          );
        })}

        <button type="button" onClick={agregarFila}
          className="w-full flex items-center justify-center gap-2 rounded-full font-bold"
          style={{ background: C.surface2, color: C.brandText, minHeight: 52, border: `1px dashed ${C.brand}` }}>
          <Plus size={18} /> Otro insumo
        </button>
      </main>

      <div className="fixed bottom-0 left-0 right-0 px-4 pt-3 space-y-1"
        style={{ background: C.bg, borderTop: `1px solid ${C.surface2}`, paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
        <p className="text-xs text-center" style={{ color: C.dim }}>
          {llenas.length} insumo(s) · valor {formatMXN(valor)}
        </p>
        <BotonPrincipal onClick={guardar} disabled={!puede || guardando}>
          {guardando ? 'Guardando…' : `Guardar ${llenas.length || ''} insumo(s)`}
        </BotonPrincipal>
      </div>
    </div>
  );
}
