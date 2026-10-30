import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/client';
import { NEGOCIO_ID } from '@/lib/negocio';

// Menú vigente para el bot de WhatsApp (o cualquier integración): lee de la base en cada
// llamada, así un cambio de precio en el panel aplica de inmediato, sin redeploy.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const { data, error } = await supabase
    .from('productos')
    .select('id, nombre, categoria, precio_whatsapp, precio_salon, precio_didi, disponible, orden')
    .eq('negocio_id', NEGOCIO_ID)
    .eq('disponible', true)
    .order('orden');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(
    { actualizado: new Date().toISOString(), productos: data },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
