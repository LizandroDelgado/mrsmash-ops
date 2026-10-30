'use client';
// Historial de cambios (auditoria_cambios): qué se editó, anuló o borró, con antes → después.
import { useEffect, useState } from 'react';
import { Header, Chips, Cargando, Vacio, C } from '@/components/ui';
import { supabase } from '@/lib/supabase/client';
import { NEGOCIO_ID } from '@/lib/negocio';
import { formatFechaHora } from '@/lib/dia';

const GRUPOS = [
  { key: 'todo',       label: 'Todo',       tablas: null },
  { key: 'pedidos',    label: 'Pedidos',    tablas: ['pedidos', 'pedido_items'] },
  { key: 'compras',    label: 'Compras',    tablas: ['compras_insumos', 'compra_items'] },
  { key: 'caja',       label: 'Caja',       tablas: ['movimientos', 'cortes_caja'] },
  { key: 'pagar',      label: 'Por pagar',  tablas: ['obligaciones', 'pagos_obligacion', 'gastos_recurrentes', 'proveedores'] },
  { key: 'inventario', label: 'Inventario', tablas: ['insumos', 'inventario_movimientos', 'conteos_inventario', 'conteo_items', 'recetas'] },
  { key: 'catalogo',   label: 'Menú y ajustes', tablas: ['productos', 'configuracion_negocio'] },
];
const TABLA = {
  pedidos: 'Pedido', pedido_items: 'Producto de pedido', compras_insumos: 'Compra', compra_items: 'Insumo de compra',
  movimientos: 'Movimiento de caja', cortes_caja: 'Corte de caja', obligaciones: 'Por pagar', pagos_obligacion: 'Pago',
  gastos_recurrentes: 'Gasto fijo', proveedores: 'Proveedor', insumos: 'Insumo', inventario_movimientos: 'Merma / inventario',
  conteos_inventario: 'Conteo', conteo_items: 'Insumo contado', recetas: 'Receta', productos: 'Producto', configuracion_negocio: 'Configuración',
};
const ACCION = { editar: ['Editado', C.warn, C.warnSoft], anular: ['Anulado', C.bad, C.badSoft], borrar: ['Borrado', C.bad, C.badSoft] };
const OCULTOS = new Set(['id', 'negocio_id', 'created_at', 'updated_at', 'anulado_at']);
const NOMBRE = ['concepto', 'descripcion', 'nombre', 'cliente_nombre', 'motivo', 'notas'];

const fmt = (v) => (v == null ? '—' : typeof v === 'boolean' ? (v ? 'sí' : 'no') : typeof v === 'object' ? JSON.stringify(v) : String(v));

export default function HistorialCambiosPage() {
  const [grupo,  setGrupo]  = useState('todo');
  const [filas,  setFilas]  = useState(null);

  useEffect(() => {
    (async () => {
      setFilas(null);
      let q = supabase.from('auditoria_cambios').select('*').eq('negocio_id', NEGOCIO_ID).order('created_at', { ascending: false }).limit(150);
      const g = GRUPOS.find((x) => x.key === grupo);
      if (g.tablas) q = q.in('tabla', g.tablas);
      const { data } = await q;
      setFilas(data || []);
    })();
  }, [grupo]);

  return (
    <div className="min-h-screen pb-10" style={{ background: C.bg }}>
      <Header titulo="Historial de cambios" back="/configuracion" />
      <main className="px-4 pt-4 space-y-3">
        <Chips options={GRUPOS} value={grupo} onChange={setGrupo} wrap />
        {!filas ? <Cargando /> : filas.length === 0 ? (
          <Vacio titulo="Sin cambios registrados" texto="Aquí aparece todo lo que edites, anules o borres." />
        ) : filas.map((f) => {
          const [txt, fg, bg] = ACCION[f.accion];
          const base = f.accion === 'borrar' ? f.antes : { ...(f.antes || {}), ...(f.despues || {}) };
          const nombre = f.etiqueta || NOMBRE.map((k) => (f.despues?.[k] ?? f.antes?.[k])).find(Boolean);
          const campos = f.accion === 'borrar' ? [] : Object.keys(f.despues || {}).filter((k) => !OCULTOS.has(k));
          return (
            <div key={f.id} className="rounded-xl px-4 py-3 space-y-1" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-ink truncate">{TABLA[f.tabla] || f.tabla}{nombre ? ` · ${nombre}` : ''}</span>
                <span className="px-2 py-0.5 rounded-full text-xs font-bold shrink-0" style={{ background: bg, color: fg }}>{txt}</span>
              </div>
              <p className="text-xs" style={{ color: C.dimmer }}>{formatFechaHora(f.created_at)}</p>
              {campos.map((k) => (
                <p key={k} className="text-xs break-words" style={{ color: C.dim }}>
                  {k.replace(/_/g, ' ')}: <span style={{ color: C.ink }}>{fmt(f.antes?.[k])}</span> → <span style={{ color: C.ink, fontWeight: 700 }}>{fmt(f.despues?.[k])}</span>
                </p>
              ))}
              {f.accion === 'borrar' && base && (
                <p className="text-xs" style={{ color: C.dim }}>
                  {['monto', 'total', 'cantidad', 'fecha', 'fecha_vencimiento'].filter((k) => k in base).map((k) => `${k.replace(/_/g, ' ')}: ${fmt(base[k])}`).join(' · ')}
                </p>
              )}
            </div>
          );
        })}
      </main>
    </div>
  );
}
