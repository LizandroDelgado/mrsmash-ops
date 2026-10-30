'use client';
// Editar un pedido completo (productos, canal, pago, cliente, fecha) en un lote atómico (RPC editar_pedido).
// Eliminar = anular: el ledger revierte la venta y el inventario regresa los consumos.
import { useEffect, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import AccionesEdicion from '@/components/AccionesEdicion';
import { Sheet, Label, Chips, TextInput, Cargando, C } from '@/components/ui';
import { supabase } from '@/lib/supabase/client';
import { formatMXN } from '@/lib/calculos';
import { vibrar, msgError, METODOS_VENTA } from '@/lib/negocio';

const CANALES = [{ key: 'whatsapp', label: 'WhatsApp' }, { key: 'salon', label: 'Salón' }, { key: 'didi', label: 'Didi' }];
const precioCanal = (p, canal) => Number(canal === 'didi' ? p.precio_didi ?? p.precio_venta
  : canal === 'salon' ? p.precio_salon ?? p.precio_whatsapp ?? p.precio_venta : p.precio_whatsapp ?? p.precio_venta) || 0;

export default function EditarPedido({ pedidoId, onClose, onGuardado }) {
  const [p,         setP]         = useState(null);
  const [items,     setItems]     = useState([]);   // { key, id?, producto_id, nombre, cantidad, precio }
  const [productos, setProductos] = useState([]);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data: ped }, { data: prods }] = await Promise.all([
        supabase.from('pedidos').select('*, pedido_items(id, producto_id, cantidad, precio, productos(nombre))').eq('id', pedidoId).single(),
        supabase.from('productos').select('id, nombre, precio_venta, precio_whatsapp, precio_salon, precio_didi, disponible').order('orden'),
      ]);
      setP({ ...ped, canal: ped.canal === 'manual' ? 'salon' : ped.canal, metodo_pago: ped.metodo_pago === 'didi' ? 'efectivo' : ped.metodo_pago || 'efectivo' });
      setItems((ped.pedido_items || []).map((i) => ({ key: i.id, id: i.id, producto_id: i.producto_id, nombre: i.productos?.nombre, cantidad: i.cantidad, precio: Number(i.precio) })));
      setProductos(prods || []);
    })();
  }, [pedidoId]);

  const cambiarCanal = (canal) => {
    setP((x) => ({ ...x, canal }));
    // Corregir el canal re-precia con el precio vigente de ese canal
    setItems((xs) => xs.map((i) => { const pr = productos.find((q) => q.id === i.producto_id); return pr ? { ...i, precio: precioCanal(pr, canal) } : i; }));
  };
  const cambiarCant = (key, d) => setItems((xs) => xs.map((i) => (i.key === key ? { ...i, cantidad: i.cantidad + d } : i)).filter((i) => i.cantidad > 0));
  const agregar = (pr) => setItems((xs) => (xs.some((i) => i.producto_id === pr.id)
    ? xs.map((i) => (i.producto_id === pr.id ? { ...i, cantidad: i.cantidad + 1 } : i))
    : [...xs, { key: `n-${pr.id}`, producto_id: pr.id, nombre: pr.nombre, cantidad: 1, precio: precioCanal(pr, p.canal) }]));

  const total = items.reduce((s, i) => s + i.cantidad * i.precio, 0);

  const guardar = async () => {
    setGuardando(true);
    const { error } = await supabase.rpc('editar_pedido', { p_pedido: pedidoId, p: {
      canal: p.canal, metodo_pago: p.canal === 'didi' ? 'didi' : p.metodo_pago,
      cliente_nombre: p.cliente_nombre || '', notas: p.notas || '', fecha: p.fecha,
      items: items.map((i) => ({ id: i.id, producto_id: i.producto_id, cantidad: i.cantidad, precio: i.precio })),
    } });
    setGuardando(false);
    if (error) { alert('No se guardó: ' + msgError(error)); return; }
    vibrar();
    onGuardado();
  };

  const anular = async () => {
    setGuardando(true);
    const { error } = await supabase.from('pedidos').update({ anulado: true }).eq('id', pedidoId);
    setGuardando(false);
    if (error) { alert('No se pudo eliminar: ' + msgError(error)); return; }
    vibrar();
    onGuardado();
  };

  return (
    <Sheet open title="Editar pedido" onClose={onClose}>
      {!p ? <Cargando /> : (
        <>
          <div>
            <Label>CANAL</Label>
            <Chips options={CANALES} value={p.canal} onChange={cambiarCanal} />
          </div>
          {p.canal !== 'didi' && (
            <div>
              <Label>¿CÓMO PAGÓ?</Label>
              <Chips options={METODOS_VENTA} value={p.metodo_pago} onChange={(v) => setP((x) => ({ ...x, metodo_pago: v }))} />
            </div>
          )}
          <div className="space-y-2">
            <Label>PRODUCTOS</Label>
            {items.map((i) => (
              <div key={i.key} className="flex items-center justify-between gap-2 rounded-xl px-3 py-2" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
                <span className="min-w-0">
                  <span className="block text-sm font-bold text-ink truncate">{i.nombre}</span>
                  <span className="block text-xs" style={{ color: C.dim }}>{formatMXN(i.precio)} c/u</span>
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  <button type="button" aria-label="Uno menos" onClick={() => cambiarCant(i.key, -1)} className="flex items-center justify-center rounded-full"
                    style={{ width: 48, background: C.surface, border: `1px solid ${C.border}` }}><Minus size={18} style={{ color: C.ink }} /></button>
                  <span className="font-display text-xl w-6 text-center" style={{ color: C.ink, fontWeight: 600 }}>{i.cantidad}</span>
                  <button type="button" aria-label="Uno más" onClick={() => cambiarCant(i.key, 1)} className="btn-accent flex items-center justify-center rounded-full"
                    style={{ width: 48 }}><Plus size={18} /></button>
                </span>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              {productos.filter((pr) => pr.disponible && !items.some((i) => i.producto_id === pr.id)).map((pr) => (
                <button key={pr.id} type="button" onClick={() => agregar(pr)} className="px-3 rounded-full text-sm"
                  style={{ background: C.surface, border: `1px dashed ${C.border}`, color: C.ink, minHeight: 44 }}>+ {pr.nombre}</button>
              ))}
            </div>
            <div className="flex items-center justify-between pt-1">
              <span className="text-sm" style={{ color: C.dim }}>{p.canal === 'didi' ? 'Total en Didi (bruto)' : 'Total'}</span>
              <span className="font-display text-2xl" style={{ color: C.ink, fontWeight: 700 }}>{formatMXN(total)}</span>
            </div>
            {p.canal === 'didi' && <p className="text-xs" style={{ color: C.dimmer }}>Lo que deposita Didi se recalcula con tus % de comisión, promos y retenciones.</p>}
          </div>
          <div>
            <Label>CLIENTE</Label>
            <TextInput value={p.cliente_nombre || ''} onChange={(v) => setP((x) => ({ ...x, cliente_nombre: v }))} placeholder="Nombre (opcional)" />
          </div>
          <div>
            <Label>NOTAS</Label>
            <TextInput value={p.notas || ''} onChange={(v) => setP((x) => ({ ...x, notas: v }))} placeholder="Notas (opcional)" />
          </div>
          <div>
            <Label>FECHA</Label>
            <TextInput type="date" value={p.fecha} onChange={(v) => setP((x) => ({ ...x, fecha: v }))} />
          </div>
          <AccionesEdicion onGuardar={guardar} onEliminar={anular} onCancelar={onClose} guardando={guardando} puedeGuardar={items.length > 0 && !!p.fecha}
            avisoEliminar="Se anula: la venta sale de Caja y el inventario regresa. Queda en el historial." />
        </>
      )}
    </Sheet>
  );
}
