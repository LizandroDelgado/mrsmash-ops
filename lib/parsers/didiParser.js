import * as XLSX from 'xlsx';
import { parse, isValid, format } from 'date-fns';

/**
 * Parsea el Excel de Didi Food y retorna objetos listos para Supabase.
 * @param {File} file - Archivo .xlsx subido
 * @param {string} negocioId - UUID del negocio en Supabase
 */
export async function parseDidiExcel(file, negocioId) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });

  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  const rows = XLSX.utils.sheet_to_json(sheet, {
    raw: false,
    dateNF: 'yyyy-mm-dd',
    defval: null,
  });

  const pedidos = [];
  const errores = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      const pedido = mapRowToPedido(row, negocioId, i + 2);
      if (pedido) pedidos.push(pedido);
    } catch (error) {
      errores.push({ fila: i + 2, error: error.message, datos: row });
    }
  }

  return {
    pedidos,
    errores,
    resumen: {
      total_filas: rows.length,
      filas_ok: pedidos.length,
      filas_error: errores.length,
      periodo_inicio: pedidos.length ? pedidos[0].fecha : null,
      periodo_fin: pedidos.length ? pedidos[pedidos.length - 1].fecha : null,
    },
  };
}

function mapRowToPedido(row, negocioId, numFila) {
  const get = (nombres) => {
    for (const n of nombres) {
      const v = row[n];
      if (v !== null && v !== undefined && v !== '') return v;
    }
    return null;
  };

  const fechaRaw = get(['Fecha', 'fecha', 'Fecha del pedido', 'Order Date', 'date']);
  if (!fechaRaw) throw new Error(`Fila ${numFila}: no se encontró campo de fecha`);

  const fecha = parseFecha(fechaRaw);

  const venta_bruta = parseNumero(get([
    'Precio original del producto', 'Venta Bruta', 'VB', 'Gross Sales', 'precio_original'
  ]));

  const comision_didi = parseNumero(get([
    'Tarifa de servicio', 'Comisión', 'C', 'Service Fee', 'commission'
  ]));

  const costo_promos = parseNumero(get([
    'Gastos por promoción de productos', 'Promo producto', 'gasto_promo'
  ])) || 0;

  const ganancia_neta = parseNumero(get([
    'Ganancias por pedido', 'Ganancia', 'M', 'Net Earnings', 'ganancia'
  ]));

  const metodo_pago_raw = get([
    'Método de pago', 'Metodo de pago', 'Payment Method', 'pago'
  ]);

  return {
    negocio_id: negocioId,
    fecha,
    venta_bruta: venta_bruta || 0,
    comision_didi: comision_didi || 0,
    costo_promos,
    ganancia_neta: ganancia_neta || 0,
    metodo_pago: normalizarMetodoPago(metodo_pago_raw),
  };
}

function parseFecha(valor) {
  if (!valor) return null;
  if (valor instanceof Date && isValid(valor)) return format(valor, 'yyyy-MM-dd');

  const formatos = [
    'yyyy-MM-dd', 'dd/MM/yyyy', 'MM/dd/yyyy',
    'yyyy-MM-dd HH:mm:ss', 'dd/MM/yyyy HH:mm',
  ];
  for (const fmt of formatos) {
    const parsed = parse(String(valor), fmt, new Date());
    if (isValid(parsed)) return format(parsed, 'yyyy-MM-dd');
  }
  throw new Error(`Formato de fecha no reconocido: "${valor}"`);
}

function parseNumero(valor) {
  if (valor === null || valor === undefined) return null;
  const limpio = String(valor).replace(/[$,\s]/g, '').trim();
  const num = parseFloat(limpio);
  return isNaN(num) ? null : num;
}

function normalizarMetodoPago(valor) {
  if (!valor) return 'tarjeta';
  const lower = String(valor).toLowerCase();
  if (lower.includes('efectivo') || lower.includes('cash')) return 'efectivo';
  return 'tarjeta';
}
