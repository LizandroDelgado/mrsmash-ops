import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/client';
import { parseDidiExcel } from '@/lib/parsers/didiParser';

export async function POST(request) {
  try {
    const supabase = createServiceClient();

    // negocio_id hardcodeado (single-tenant) — evita depender de permisos en tabla negocios
    const negocioId = '34797ee1-37fa-4736-ad56-35578a126b08';

    const formData = await request.formData();
    const file = formData.get('archivo');

    if (!file) {
      return NextResponse.json({ error: 'No se recibió archivo' }, { status: 400 });
    }

    const { pedidos, errores, resumen } = await parseDidiExcel(file, negocioId);

    if (pedidos.length === 0) {
      return NextResponse.json({
        success: false,
        mensaje: 'No se encontraron pedidos válidos en el archivo',
        errores,
        resumen,
      });
    }

    // Upsert en importaciones_didi — duplicados se ignoran silenciosamente.
    // Requiere restricción UNIQUE (negocio_id, fecha, venta_bruta, metodo_pago) en la tabla.
    const { data: insertados, error: upsertError } = await supabase
      .from('importaciones_didi')
      .upsert(pedidos, {
        onConflict: 'negocio_id,fecha,venta_bruta,metodo_pago',
        ignoreDuplicates: true,
      })
      .select();

    if (upsertError) {
      return NextResponse.json({
        error: 'Error al guardar los pedidos',
        detalle: upsertError.message,
      }, { status: 500 });
    }

    const nuevos      = insertados?.length ?? 0;
    const duplicados  = pedidos.length - nuevos;

    let mensaje;
    if (nuevos === 0) {
      mensaje = `Todos los ${duplicados} registros ya existían (sin cambios)`;
    } else if (duplicados > 0) {
      mensaje = `${nuevos} registros nuevos importados · ${duplicados} duplicados ignorados`;
    } else {
      mensaje = `Se importaron ${nuevos} registros correctamente`;
    }

    return NextResponse.json({
      success: true,
      mensaje,
      nuevos,
      duplicados,
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
