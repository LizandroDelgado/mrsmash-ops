import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/client';

export async function POST(request) {
  try {
    const supabase = createServiceClient();
    const body = await request.json();

    const { negocio_id, descripcion, monto, categoria, fecha } = body;

    if (!negocio_id || !descripcion || !monto) {
      return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('compras_insumos')
      .insert({ negocio_id, descripcion, monto, categoria, fecha })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
