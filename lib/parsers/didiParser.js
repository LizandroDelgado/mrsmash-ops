import * as XLSX from 'xlsx';
import { parse, isValid, format } from 'date-fns';

// ── Hoja objetivo ─────────────────────────────────────────────────────────────
const HOJA = 'Detalles de la factura';

// ── Valores válidos en la columna "Tipo de documento" ────────────────────────
// Didi cambió el nombre entre versiones del reporte — aceptar ambos
const TIPOS_INGRESO = new Set([
  'Ingresos por pedidos',   // formato antiguo
  'Ganancias por pedidos',  // formato nuevo
]);

// ── Nombres de columna por campo (varios por si Didi cambia nombres) ──────────
const COLS = {
  tipo_doc: [
    'Tipo de documento',
  ],
  fecha: [
    'Fecha del pedido a la tienda',
  ],
  venta_bruta: [
    'Precio total del artículo sin promoción',  // formato antiguo
    'Precio total del producto sin promoción',  // formato nuevo
  ],
  comision: [
    'Comisión y distribución',
  ],
  costo_promos: [
    'Inversión de promoción de artículos de la tienda',
  ],
  ganancia_neta: [
    'Ingresos por pedidos',   // formato antiguo (mismo texto que el valor de tipo_doc)
    'Ganancias por pedidos',  // formato nuevo
  ],
  metodo_pago: [
    'Método de pago',
  ],
  nombre_restaurante: [
    'Nombre del restaurante',  // formato antiguo
    'Nombre de la tienda',     // formato nuevo
  ],
};

/**
 * Parsea el Excel de Didi Food México.
 *
 * Estructura del archivo:
 *   Fila 1 (idx 0): encabezado de sección → se omite con range:1
 *   Fila 2 (idx 1): nombres de columnas reales → usada como header
 *   Fila 3+ (idx 2+): datos
 *
 * Equivalente pandas: pd.read_excel(file, sheet_name='Detalles de la factura', header=1)
 *
 * @param {File}   file      - Archivo .xlsx subido
 * @param {string} negocioId - UUID del negocio en Supabase
 */
export async function parseDidiExcel(file, negocioId) {
  const buffer   = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });

  // Buscar hoja exacta; caer al primer sheet si no existe
  const sheetName = workbook.SheetNames.find((n) => n.trim() === HOJA)
    ?? workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  // range:1 → salta fila 0 (encabezado de sección)
  //           fila 1 se convierte en header (nombres de columnas)
  //           datos arrancan en fila 2
  const rows = XLSX.utils.sheet_to_json(sheet, {
    range:  1,
    raw:    false,
    defval: null,
  });

  // ── DEBUG ─────────────────────────────────────────────────────────────────
  const columnasDisponibles = rows.length > 0 ? Object.keys(rows[0]) : [];
  console.log(`[didiParser] Hoja: "${sheetName}" | Total filas: ${rows.length}`);
  console.log('[didiParser] Columnas:', columnasDisponibles);

  const pedidos = [];
  const errores = [];

  for (let i = 0; i < rows.length; i++) {
    const row  = rows[i];
    const tipo = getCol(row, COLS.tipo_doc);

    // Solo procesar filas de ingresos/ganancias por pedidos
    if (!tipo || !TIPOS_INGRESO.has(String(tipo).trim())) continue;

    try {
      const pedido = mapRowToPedido(row, negocioId, i + 3);
      if (pedido) pedidos.push(pedido);
    } catch (err) {
      errores.push({ fila: i + 3, error: err.message });
    }
  }

  return {
    pedidos,
    errores,
    columnasDisponibles,
    resumen: {
      total_filas:    rows.length,
      filas_ok:       pedidos.length,
      filas_error:    errores.length,
      periodo_inicio: pedidos.length ? pedidos[0].fecha                  : null,
      periodo_fin:    pedidos.length ? pedidos[pedidos.length - 1].fecha : null,
    },
  };
}

// ── Mapeo fila → objeto Supabase ──────────────────────────────────────────────

function mapRowToPedido(row, negocioId, numFila) {
  const fechaRaw = getCol(row, COLS.fecha);
  if (!fechaRaw) throw new Error(`Fila ${numFila}: sin fecha`);

  const fecha = parseFecha(fechaRaw);
  if (!fecha) throw new Error(`Fila ${numFila}: fecha no parseable "${fechaRaw}"`);

  // Comisión y promos vienen negativos en el Excel → guardar como positivos
  const venta_bruta   =            parseNumero(getCol(row, COLS.venta_bruta))   ?? 0;
  const comision_didi = Math.abs(  parseNumero(getCol(row, COLS.comision))      ?? 0);
  const costo_promos  = Math.abs(  parseNumero(getCol(row, COLS.costo_promos))  ?? 0);
  const ganancia_neta =            parseNumero(getCol(row, COLS.ganancia_neta)) ?? 0;

  return {
    negocio_id:    negocioId,
    fecha,
    venta_bruta,
    comision_didi,
    costo_promos,
    ganancia_neta,
    metodo_pago: normalizarMetodoPago(getCol(row, COLS.metodo_pago)),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Busca el valor de la primera columna que exista en la fila.
 * Permite manejar múltiples nombres de columna entre versiones del reporte.
 */
function getCol(row, nombres) {
  for (const nombre of nombres) {
    const v = row[nombre];
    if (v !== null && v !== undefined && v !== '') return v;
  }
  return null;
}

function parseFecha(valor) {
  if (!valor) return null;

  // XLSX con cellDates:true puede devolver un objeto Date directamente
  if (valor instanceof Date && isValid(valor)) return format(valor, 'yyyy-MM-dd');

  const str = String(valor).trim();

  // Formato principal del Excel de Didi México: "28/04/2026 17:25"
  const formatos = [
    'dd/MM/yyyy HH:mm',
    'dd/MM/yyyy HH:mm:ss',
    'dd/MM/yyyy',
    'yyyy-MM-dd HH:mm:ss',
    'yyyy-MM-dd HH:mm',
    'yyyy-MM-dd',
    'MM/dd/yyyy HH:mm',
    'MM/dd/yyyy',
    'yyyy/MM/dd HH:mm:ss',
    'yyyy/MM/dd',
    'd/M/yyyy H:mm',
    'd/M/yyyy',
  ];

  for (const fmt of formatos) {
    const parsed = parse(str, fmt, new Date());
    if (isValid(parsed)) return format(parsed, 'yyyy-MM-dd');
  }

  // Último recurso: Date nativo de JS
  const nativo = new Date(str);
  if (isValid(nativo)) return format(nativo, 'yyyy-MM-dd');

  return null;
}

function parseNumero(valor) {
  if (valor === null || valor === undefined) return null;
  const limpio = String(valor).replace(/[$,\s￥¥]/g, '').trim();
  const num    = parseFloat(limpio);
  return isNaN(num) ? null : num;
}

function normalizarMetodoPago(valor) {
  if (!valor) return 'tarjeta';
  const lower = String(valor).toLowerCase();
  if (lower.includes('efectivo') || lower.includes('cash') || lower.includes('现金')) return 'efectivo';
  return 'tarjeta';
}
