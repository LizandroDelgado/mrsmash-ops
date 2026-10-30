'use client';
// Editar una compra de insumos (el ledger revierte y re-publica) o anularla:
// se revierte el dinero (o se cancela el crédito) y la entrada a inventario, y el costo
// promedio de cada insumo se recalcula reproduciendo sus compras.
import { useState } from 'react';
import { Package } from 'lucide-react';
import AccionesEdicion from '@/components/AccionesEdicion';
import { Sheet, Label, Chips, MontoInput, TextInput, BotonSecundario, C } from '@/components/ui';
import { supabase } from '@/lib/supabase/client';
import { METODOS_COMPRA, vibrar, msgError } from '@/lib/negocio';

const CATEGORIAS = ['Carne', 'Pan', 'Verdura', 'Salsas', 'Empaque', 'Otro'].map((c) => ({ key: c, label: c }));

export default function EditarCompra({ compra, proveedores, onClose, onGuardado, onDesglose }) {
  const [f, setF] = useState({
    descripcion: compra.descripcion, monto: String(Number(compra.monto)), categoria: compra.categoria || 'Otro',
    fecha: compra.fecha, metodo_pago: compra.metodo_pago || 'efectivo', proveedor_id: compra.proveedor_id,
  });
  const [guardando, setGuardando] = useState(false);

  const correr = async (fn, msg) => {
    setGuardando(true);
    const { error } = await fn();
    setGuardando(false);
    if (error) { alert(msgError(error)); return; }
    vibrar();
    onGuardado(msg);
  };

  return (
    <Sheet open title="Editar compra" onClose={onClose}>
      <TextInput value={f.descripcion} onChange={(v) => setF({ ...f, descripcion: v })} placeholder="¿Qué compraste?" />
      <MontoInput value={f.monto} onChange={(v) => setF({ ...f, monto: v })} />
      <div><Label>CATEGORÍA</Label><Chips options={CATEGORIAS} value={f.categoria} onChange={(v) => setF({ ...f, categoria: v })} wrap /></div>
      <div><Label>¿CÓMO PAGASTE?</Label><Chips options={METODOS_COMPRA} value={f.metodo_pago} onChange={(v) => setF({ ...f, metodo_pago: v })} /></div>
      {proveedores.length > 0 && (
        <div><Label>PROVEEDOR</Label>
          <Chips options={[{ key: null, label: 'Ninguno' }, ...proveedores.map((p) => ({ key: p.id, label: p.nombre }))]}
            value={f.proveedor_id} onChange={(v) => setF({ ...f, proveedor_id: v })} wrap /></div>
      )}
      <div><Label>FECHA</Label><TextInput type="date" value={f.fecha} onChange={(v) => setF({ ...f, fecha: v })} /></div>
      <BotonSecundario onClick={onDesglose}>
        <span className="flex items-center justify-center gap-2"><Package size={16} /> Insumos de esta compra ({compra.compra_items?.length || 0})</span>
      </BotonSecundario>
      <AccionesEdicion guardando={guardando}
        puedeGuardar={!!f.descripcion.trim() && parseFloat(f.monto) > 0 && !!f.fecha}
        onGuardar={() => correr(() => supabase.from('compras_insumos').update({
          descripcion: f.descripcion.trim(), monto: parseFloat(f.monto), categoria: f.categoria, fecha: f.fecha,
          metodo_pago: f.metodo_pago, proveedor_id: f.proveedor_id,
          // Al cambiar a crédito, el vencimiento se recalcula con los días del proveedor
          ...(f.metodo_pago !== compra.metodo_pago || f.proveedor_id !== compra.proveedor_id || f.fecha !== compra.fecha ? { fecha_vencimiento: null } : {}),
        }).eq('id', compra.id), 'Compra actualizada')}
        onEliminar={() => correr(() => supabase.from('compras_insumos').update({ anulado: true }).eq('id', compra.id), 'Compra eliminada: dinero e inventario revertidos')}
        onCancelar={onClose}
        avisoEliminar="Se anula: el dinero regresa (o se cancela el crédito), sale del inventario y el costo promedio se recalcula." />
    </Sheet>
  );
}
