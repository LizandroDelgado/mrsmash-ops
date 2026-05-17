import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/client';

export async function POST(request) {
  try {
    const supabase = createServiceClient();
    const body = await request.json();

    const { negocio_id, canal, cliente_nombre, notas, total, fecha, hora, items } = body;

    if (!negocio_id || !items?.length) {
      return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 });
    }

    const { data: pedido, error: pedidoError } = await supabase
      .from('pedidos')
      .insert({ negocio_id, canal, cliente_nombre, notas, estado: 'en_preparacion', total, fecha, hora })
      .select()
      .single();

    if (pedidoError) throw pedidoError;

    const { error: itemsError } = await supabase
      .from('pedido_items')
      .insert(items.map((i) => ({ ...i, pedido_id: pedido.id })));

    if (itemsError) throw itemsError;

    return NextResponse.json({ success: true, pedido });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const supabase = createServiceClient();
    const { id, estado } = await request.json();

    const { error } = await supabase
      .from('pedidos')
      .update({ estado })
      .eq('id', id);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
