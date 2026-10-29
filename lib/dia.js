// Día operativo en el cliente: mismo criterio que la función SQL dia_operativo().
// Tepic = America/Mazatlan (UTC-7). Corte a las 05:00: 00:00–04:59 cuenta al día anterior.
export const ZONA = 'America/Mazatlan';
export const HORA_CORTE = 5;

const fmtFecha = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }); // yyyy-MM-dd

export function diaOperativo(date = new Date()) {
  return fmtFecha.format(new Date(date.getTime() - HORA_CORTE * 3600e3));
}

export function sumarDias(fechaStr, dias) {
  const d = new Date(fechaStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export function diasEntre(desdeStr, hastaStr) {
  return Math.round((new Date(hastaStr + 'T12:00:00Z') - new Date(desdeStr + 'T12:00:00Z')) / 86400e3);
}

export function formatDiaCorto(fechaStr) {
  return new Date(fechaStr + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function formatFechaHora(ts) {
  return new Date(ts).toLocaleString('es-MX', {
    timeZone: ZONA, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}
