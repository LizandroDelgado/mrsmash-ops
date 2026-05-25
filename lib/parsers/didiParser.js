import * as XLSX from 'xlsx';
import { parse, isValid, format } from 'date-fns';

// ── Nombres exactos de columnas en el Excel de Didi Food México ─────────────
const HOJA              = 'Detalles de la factura';
const TIPO_INGRESO      = 'Ingresos por pedidos';  // valor de filtro en col "Tipo de documento"

const COL_TIPO_DOC      = 'Tipo de documento';                                    // idx 8
const COL_FECHA         = 'Fecha del pedido a la tienda';                         // idx 5  "28/04/2026 17:25"
const COL_VENTA_BRUTA   = 'Precio total del artículo sin promoción';              // idx 12
const COL_COMISION      = 'Comisión y distribución';                              // idx 22 (negativo)
const COL_COSTO_PROMOS  = 'Inversión de promoción de artículos de la tienda';    // idx 15 (negativo)
const COL_GANANCIA_NETA = 'Ingresos por pedidos';                                 // idx 30
const COL_METODO_PAGO   = 'Método de pago';                                       // idx 10

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

  // range:1  → salta la fila 0 (encabezado de sección)
  //            la fila 1 se convierte en header (nombres de columnas)
  //            los datos arrancan en la fila 2
  const rows = XLSX.utils.sheet_to_json(sheet, {
    range:   1,
    raw:     false,   // valores como strings/fechas formateadas
    defval:  null,
  });

  // ── DEBUG ────────────────────────────────────────────────────────────────
  const columnasDisponibles = rows.length > 0 ? Object.keys(rows[0]) : [];
  console.log(`[didiParser] Hoja: "${sheetName}" | Total filas: ${rows.length}`);
  console.log('[didiParser] Columnas:', columnasDisponibles);

  const pedidos = [];
  const errores = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    // Filtrar solo filas de tipo "Ingresos por pedidos"
    const tipo = row[COL_TIPO_DOC];
    if (!tipo || String(tipo).trim() !== TIPO_INGRESO) continue;

    try {
      const pedido = mapRowToPedido(row, negocioId, i + 3); // +3: fila real en Excel
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

// ── Mapeo fila → objeto Supabase ─────────────────────────────────────────────

function mapRowToPedido(row, negocioId, numFila) {
  const fechaRaw = row[COL_FECHA];
  if (!fechaRaw) throw new Error(`Fila ${numFila}: sin fecha`);

  const fecha = parseFecha(fechaRaw);
  if (!fecha) throw new Error(`Fila ${numFila}: fecha no parseable "${fechaRaw}"`);

  // Comisión y promos vienen negativos en el Excel → guardar como positivos
  const venta_bruta   = parseNumero(row[COL_VENTA_BRUTA])  ?? 0;
  const comision_didi = Math.abs(parseNumero(row[COL_COMISION])     ?? 0);
  const costo_promos  = Math.abs(parseNumero(row[COL_COSTO_PROMOS]) ?? 0);
  const ganancia_neta = parseNumero(row[COL_GANANCIA_NETA]) ?? 0;

  return {
    negocio_id:    negocioId,
    fecha,
    venta_bruta,
    comision_didi,
    costo_promos,
    ganancia_neta,
    metodo_pago: normalizarMetodoPago(row[COL_METODO_PAGO]),
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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

  // Último recurso: Date nativo
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
