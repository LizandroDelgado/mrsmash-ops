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

  // ── DEBUG: siempre loguear columnas disponibles ──────────────────────────
  const columnasDisponibles = rows.length > 0 ? Object.keys(rows[0]) : [];
  console.log(`[didiParser] Hoja: "${sheetName}" | Filas: ${rows.length}`);
  console.log('[didiParser] Columnas encontradas:', columnasDisponibles);

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
    columnasDisponibles,   // ← siempre devolver para debug
    resumen: {
      total_filas:     rows.length,
      filas_ok:        pedidos.length,
      filas_error:     errores.length,
      periodo_inicio:  pedidos.length ? pedidos[0].fecha                    : null,
      periodo_fin:     pedidos.length ? pedidos[pedidos.length - 1].fecha   : null,
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

  // ── FECHA ────────────────────────────────────────────────────────────────
  // ES: "Fecha", "Fecha del pedido"  |  ZH: "日期", "创建时间", "下单时间"
  const fechaRaw = get([
    '日期', '创建时间', '下单时间',
    'Fecha', 'fecha', 'Fecha del pedido', 'FECHA',
    'Date', 'date', 'Order Date',
  ]);
  if (!fechaRaw) {
    const cols = Object.keys(row).join(', ');
    throw new Error(`Fila ${numFila}: no se encontró columna de fecha. Columnas disponibles: ${cols}`);
  }
  const fecha = parseFecha(fechaRaw);

  // ── VENTA BRUTA ──────────────────────────────────────────────────────────
  // ES: "Precio original del producto", "Venta Bruta"  |  ZH: "原始商品价格", "商品金额", "订单金额"
  const venta_bruta = parseNumero(get([
    '原始商品价格', '商品金额', '订单金额',
    'Precio original del producto', 'Venta Bruta', 'VB', 'venta_bruta',
    'Gross Sales', 'precio_original',
  ]));

  // ── COMISIÓN ─────────────────────────────────────────────────────────────
  // ES: "Tarifa de servicio", "Comisión"  |  ZH: "服务费", "平台服务费", "佣金"
  const comision_didi = parseNumero(get([
    '服务费', '平台服务费', '佣金',
    'Tarifa de servicio', 'Comisión', 'Comision', 'C', 'commission',
    'Service Fee',
  ]));

  // ── COSTO PROMOS ─────────────────────────────────────────────────────────
  // ES: "Gastos por promoción de productos"  |  ZH: "营销费用", "促销费用", "优惠券费用"
  const costo_promos = parseNumero(get([
    '营销费用', '促销费用', '优惠券费用', '商家补贴',
    'Gastos por promoción de productos', 'Promo producto', 'gasto_promo',
    'Promotion Cost',
  ])) || 0;

  // ── GANANCIA NETA ────────────────────────────────────────────────────────
  // ES: "Ganancias por pedido"  |  ZH: "订单收入", "实际收款", "商家实收"
  const ganancia_neta = parseNumero(get([
    '订单收入', '实际收款', '商家实收', '实收金额',
    'Ganancias por pedido', 'Ganancia', 'M', 'ganancia',
    'Net Earnings',
  ]));

  // ── MÉTODO DE PAGO ───────────────────────────────────────────────────────
  // ES: "Método de pago"  |  ZH: "支付方式", "付款方式"
  const metodo_pago_raw = get([
    '支付方式', '付款方式', '付款类型',
    'Método de pago', 'Metodo de pago', 'metodo_pago',
    'Payment Method', 'pago',
  ]);

  return {
    negocio_id:    negocioId,
    fecha,
    venta_bruta:   venta_bruta   || 0,
    comision_didi: comision_didi || 0,
    costo_promos,
    ganancia_neta: ganancia_neta || 0,
    metodo_pago:   normalizarMetodoPago(metodo_pago_raw),
  };
}

function parseFecha(valor) {
  if (!valor) return null;
  if (valor instanceof Date && isValid(valor)) return format(valor, 'yyyy-MM-dd');

  const str = String(valor).trim();

  const formatos = [
    'yyyy-MM-dd',
    'dd/MM/yyyy',
    'MM/dd/yyyy',
    'yyyy/MM/dd',
    'yyyy-MM-dd HH:mm:ss',
    'yyyy/MM/dd HH:mm:ss',
    'dd/MM/yyyy HH:mm',
    'MM/dd/yyyy HH:mm',
    'd/M/yyyy',
    'M/d/yyyy',
  ];
  for (const fmt of formatos) {
    const parsed = parse(str, fmt, new Date());
    if (isValid(parsed)) return format(parsed, 'yyyy-MM-dd');
  }

  // Último intento: Date nativo (maneja ISO y muchos otros)
  const nativo = new Date(str);
  if (isValid(nativo)) return format(nativo, 'yyyy-MM-dd');

  throw new Error(`Formato de fecha no reconocido: "${valor}"`);
}

function parseNumero(valor) {
  if (valor === null || valor === undefined) return null;
  const limpio = String(valor).replace(/[$,\s￥¥]/g, '').trim();
  const num = parseFloat(limpio);
  return isNaN(num) ? null : num;
}

function normalizarMetodoPago(valor) {
  if (!valor) return 'tarjeta';
  const lower = String(valor).toLowerCase();
  if (lower.includes('efectivo') || lower.includes('cash') || lower.includes('现金')) return 'efectivo';
  return 'tarjeta';
}
