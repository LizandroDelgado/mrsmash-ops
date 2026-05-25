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

    const { pedidos, errores, resumen, columnasDisponibles } = await parseDidiExcel(file, negocioId);

    if (pedidos.length === 0) {
      return NextResponse.json({
        success: false,
        mensaje: 'No se encontraron pedidos válidos en el archivo',
        columnasDisponibles,
        errores,
        resumen,
      });
    }

    // ── Normalizar payload: solo columnas que existen en importaciones_didi ──
    // Columnas: negocio_id, fecha, venta_bruta, comision_didi,
    //           costo_promos, ganancia_neta, metodo_pago, didi_order_id
    const payload = pedidos.map((p) => ({
      negocio_id:    p.negocio_id,
      fecha:         p.fecha,
      venta_bruta:   p.venta_bruta,
      comision_didi: p.comision_didi,
      costo_promos:  p.costo_promos,
      ganancia_neta: p.ganancia_neta,
      metodo_pago:   p.metodo_pago,
      // didi_order_id no viene en el Excel de detalle de pagos → null
      ...(p.didi_order_id !== undefined ? { didi_order_id: p.didi_order_id } : {}),
    }));

    // Debug: loguear el primer registro para verificar estructura
    console.log('[importar-didi] Primer registro a insertar:', JSON.stringify(payload[0], null, 2));
    console.log(`[importar-didi] Total registros: ${payload.length}`);

    // Upsert — duplicados ignorados silenciosamente
    // Requiere UNIQUE (negocio_id, fecha, venta_bruta, metodo_pago) en la tabla
    const { data: insertados, error: upsertError } = await supabase
      .from('importaciones_didi')
      .upsert(payload, {
        onConflict:       'negocio_id,fecha,venta_bruta,metodo_pago',
        ignoreDuplicates: true,
      })
      .select();

    if (upsertError) {
      console.error('[importar-didi] Supabase error:', upsertError);
      return NextResponse.json({
        error:   'Error al guardar los pedidos',
        detalle: upsertError.message,
        code:    upsertError.code,
        hint:    upsertError.hint,
        details: upsertError.details,
        // Muestra el primer registro que se intentó insertar para diagnóstico
        primer_registro: payload[0],
      }, { status: 500 });
    }

    const nuevos     = insertados?.length ?? 0;
    const duplicados = payload.length - nuevos;

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
    console.error('[importar-didi] Error interno:', error);
    return NextResponse.json({
      error:   'Error interno del servidor',
      detalle: error.message,
      stack:   process.env.NODE_ENV === 'development' ? error.stack : undefined,
    }, { status: 500 });
  }
}
