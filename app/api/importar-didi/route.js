import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/client';
import { parseDidiExcel } from '@/lib/parsers/didiParser';

export async function POST(request) {
  try {
    const supabase = createServiceClient();

    // Obtener negocio_id del primer negocio (single-tenant por ahora)
    const { data: negocio } = await supabase
      .from('negocios')
      .select('id')
      .limit(1)
      .single();

    if (!negocio?.id) {
      return NextResponse.json({ error: 'Negocio no encontrado' }, { status: 400 });
    }

    const formData = await request.formData();
    const file = formData.get('archivo');

    if (!file) {
      return NextResponse.json({ error: 'No se recibió archivo' }, { status: 400 });
    }

    const { pedidos, errores, resumen } = await parseDidiExcel(file, negocio.id);

    if (pedidos.length === 0) {
      return NextResponse.json({
        success: false,
        mensaje: 'No se encontraron pedidos válidos en el archivo',
        errores,
        resumen,
      });
    }

    // Insertar en importaciones_didi
    const { data: insertados, error: insertError } = await supabase
      .from('importaciones_didi')
      .insert(pedidos)
      .select();

    if (insertError) {
      return NextResponse.json({
        error: 'Error al guardar los pedidos',
        detalle: insertError.message,
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      mensaje: `Se importaron ${insertados.length} registros correctamente`,
      errores: errores.length > 0 ? errores : undefined,
      resumen,
    });
  } catch (error) {
    console.error('Error en importación:', error);
    return NextResponse.json({
      error: 'Error interno del servidor',
      detalle: error.message,
    }, { status: 500 });
  }
}
