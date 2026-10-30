'use client';
import { useEffect, useState } from 'react';
import { Upload, FileSpreadsheet, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import BottomNav from '@/components/BottomNav';
import { Header } from '@/components/ui';
import MasMenu from '@/components/MasMenu';
import { supabase } from '@/lib/supabase/client';

export default function ImportarPage() {
  const [estado,       setEstado]       = useState('idle'); // idle | procesando | terminado
  const [progreso,     setProgreso]     = useState({ actual: 0, total: 0, nombre: '' });
  const [resultados,   setResultados]   = useState([]);     // por archivo
  const [resumenFinal, setResumenFinal] = useState(null);
  const [historial,    setHistorial]    = useState([]);

  useEffect(() => { cargarHistorial(); }, []);

  const cargarHistorial = async () => {
    const { data } = await supabase
      .from('importaciones_didi')
      .select('fecha, venta_bruta, ganancia_neta')
      .order('fecha', { ascending: false })
      .limit(5);
    if (data) setHistorial(data);
  };

  const handleArchivos = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const invalidos = files.filter((f) => !f.name.match(/\.(xlsx|xls)$/i));
    if (invalidos.length > 0) {
      alert(`Archivos no válidos (solo .xlsx/.xls):\n${invalidos.map((f) => f.name).join('\n')}`);
      e.target.value = '';
      return;
    }

    setEstado('procesando');
    setResultados([]);
    setResumenFinal(null);

    const acum = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setProgreso({ actual: i + 1, total: files.length, nombre: file.name });

      try {
        const formData = new FormData();
        formData.append('archivo', file);

        const res  = await fetch('/api/importar-didi', { method: 'POST', body: formData });
        const data = await res.json();

        acum.push({
          nombre:              file.name,
          success:             !!data.success,
          nuevos:              data.nuevos     ?? 0,
          duplicados:          data.duplicados ?? 0,
          mensaje:             data.mensaje    ?? data.error ?? 'Sin respuesta',
          errores:             data.errores,
          resumen:             data.resumen,
          columnasDisponibles: data.columnasDisponibles,
          // debug de error Supabase
          errorCode:           data.code,
          errorHint:           data.hint,
          errorDetails:        data.details,
          primerRegistro:      data.primer_registro,
        });
      } catch {
        acum.push({
          nombre:     file.name,
          success:    false,
          nuevos:     0,
          duplicados: 0,
          mensaje:    'Error de conexión',
        });
      }

      // Actualizar lista en tiempo real
      setResultados([...acum]);
    }

    setResumenFinal({
      total:            files.length,
      archivosOk:       acum.filter((r) => r.success).length,
      archivosFallidos: acum.filter((r) => !r.success).length,
      totalNuevos:      acum.reduce((s, r) => s + r.nuevos, 0),
      totalDuplicados:  acum.reduce((s, r) => s + r.duplicados, 0),
    });

    setEstado('terminado');
    cargarHistorial();
    e.target.value = '';
  };

  const pctProgreso = progreso.total > 0
    ? Math.round((progreso.actual / progreso.total) * 100)
    : 0;

  return (
    <div className="flex flex-col min-h-screen" style={{ background: 'var(--cream)' }}>
      <Header titulo="Importar Didi" right={<MasMenu />} />

      <main className="flex-1 px-4 pt-6 pb-32 space-y-6">

        {/* ── ZONA DE UPLOAD ── */}
        <div
          className="rounded-2xl p-8 text-center"
          style={{ background: 'var(--paper)', border: '2px dashed var(--line)' }}
        >
          <FileSpreadsheet
            size={48}
            className="mx-auto mb-4"
            style={{ color: estado === 'terminado' ? 'var(--good-ink)' : 'var(--orange-text)' }}
          />

          <p className="font-bold text-ink mb-1">Sube tu reporte de DiDi</p>
          <p className="text-sm mb-1" style={{ color: 'var(--ink-soft)' }}>DiDi Tienda → Finanzas</p>
          <p className="text-sm mb-1" style={{ color: 'var(--ink-soft)' }}>→ Enviar reporte → Detalle de pagos</p>
          <p className="text-xs mb-6" style={{ color: 'var(--ink-mute)' }}>Puedes seleccionar varios archivos a la vez</p>

          <label className="cursor-pointer">
            <input
              type="file"
              accept=".xlsx,.xls"
              multiple
              onChange={handleArchivos}
              className="hidden"
              disabled={estado === 'procesando'}
            />
            <span
              className="inline-block px-8 py-4 rounded-xl font-bold text-ink"
              style={{
                background: estado === 'procesando' ? 'var(--paper-2)' : 'var(--orange-fill)',
                opacity:    estado === 'procesando' ? 0.7 : 1,
              }}
            >
              {estado === 'procesando' ? 'Procesando...' : 'SELECCIONAR ARCHIVOS'}
            </span>
          </label>
        </div>

        {/* ── PROGRESO (mientras procesa) ── */}
        {estado === 'procesando' && (
          <div
            className="rounded-2xl p-4 space-y-3"
            style={{ background: 'var(--paper)', border: '1px solid var(--line)' }}
          >
            {/* Texto de progreso */}
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-ink">
                Procesando {progreso.actual} de {progreso.total}
              </p>
              <p className="text-sm font-bold" style={{ color: 'var(--orange-text)' }}>{pctProgreso}%</p>
            </div>

            {/* Nombre del archivo actual */}
            <p className="text-xs truncate" style={{ color: 'var(--ink-soft)' }}>{progreso.nombre}</p>

            {/* Barra de progreso */}
            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--line)' }}>
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{ width: `${pctProgreso}%`, background: 'var(--orange-fill)' }}
              />
            </div>

            {/* Mini lista de resultados en tiempo real */}
            {resultados.length > 0 && (
              <div className="space-y-1 pt-1">
                {resultados.map((r, i) => (
                  <div key={i} className="flex items-center gap-2">
                    {r.success
                      ? <CheckCircle size={13} style={{ color: 'var(--good-ink)', flexShrink: 0 }} />
                      : <XCircle    size={13} style={{ color: 'var(--bad-ink)', flexShrink: 0 }} />
                    }
                    <span className="text-xs truncate" style={{ color: r.success ? 'var(--ink-soft)' : 'var(--bad-ink)' }}>
                      {r.nombre}
                    </span>
                    {r.success && (
                      <span className="text-xs ml-auto whitespace-nowrap" style={{ color: 'var(--ink-mute)' }}>
                        +{r.nuevos}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── RESUMEN FINAL ── */}
        {estado === 'terminado' && resumenFinal && (
          <div
            className="rounded-2xl p-4 space-y-3"
            style={{
              background: resumenFinal.archivosFallidos === 0
                ? 'var(--good-soft)'
                : 'var(--warn-soft)',
              border: `1px solid ${resumenFinal.archivosFallidos === 0
                ? 'var(--good-line)'
                : 'var(--warn-line)'}`,
            }}
          >
            {/* Título */}
            <div className="flex items-center gap-2">
              {resumenFinal.archivosFallidos === 0
                ? <CheckCircle size={20} style={{ color: 'var(--good-ink)' }} />
                : <AlertCircle size={20} style={{ color: 'var(--warn-ink)' }} />
              }
              <span className="font-bold text-ink">
                {resumenFinal.archivosFallidos === 0
                  ? `${resumenFinal.total} ${resumenFinal.total === 1 ? 'archivo procesado' : 'archivos procesados'}`
                  : `${resumenFinal.archivosOk} de ${resumenFinal.total} archivos procesados`
                }
              </span>
            </div>

            {/* KPIs */}
            <div className="flex gap-2">
              {resumenFinal.totalNuevos > 0 && (
                <span
                  className="px-3 py-1 rounded-full text-xs font-bold"
                  style={{ background: 'var(--good-soft)', color: 'var(--good-ink)' }}
                >
                  ✓ {resumenFinal.totalNuevos} nuevos
                </span>
              )}
              {resumenFinal.totalDuplicados > 0 && (
                <span
                  className="px-3 py-1 rounded-full text-xs font-bold"
                  style={{ background: 'var(--warn-soft)', color: 'var(--warn-ink)' }}
                >
                  ⊘ {resumenFinal.totalDuplicados} ya existían
                </span>
              )}
              {resumenFinal.archivosFallidos > 0 && (
                <span
                  className="px-3 py-1 rounded-full text-xs font-bold"
                  style={{ background: 'var(--bad-soft)', color: 'var(--bad-ink)' }}
                >
                  ✗ {resumenFinal.archivosFallidos} fallidos
                </span>
              )}
            </div>

            {/* Detalle por archivo */}
            <details>
              <summary
                className="text-xs cursor-pointer select-none"
                style={{ color: 'var(--ink-mute)' }}
              >
                Ver detalle por archivo
              </summary>
              <div className="mt-2 space-y-1">
                {resultados.map((r, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 py-1"
                    style={{ borderTop: i > 0 ? '1px solid var(--paper-2)' : 'none' }}
                  >
                    {r.success
                      ? <CheckCircle size={13} style={{ color: 'var(--good-ink)', flexShrink: 0, marginTop: 2 }} />
                      : <XCircle    size={13} style={{ color: 'var(--bad-ink)', flexShrink: 0, marginTop: 2 }} />
                    }
                    <div className="flex-1 min-w-0">
                      <p className="text-xs truncate" style={{ color: 'var(--ink-soft)' }}>{r.nombre}</p>
                      <p className="text-xs" style={{ color: r.success ? 'var(--ink-mute)' : 'var(--bad-ink)' }}>
                        {r.mensaje}
                      </p>
                      {!r.success && r.errorCode && (
                        <p className="text-xs mt-0.5 font-mono" style={{ color: 'var(--warn-ink)' }}>
                          code: {r.errorCode}{r.errorHint ? ` · ${r.errorHint}` : ''}
                        </p>
                      )}
                      {!r.success && r.primerRegistro && (
                        <details className="mt-1">
                          <summary className="text-xs cursor-pointer" style={{ color: 'var(--ink-mute)' }}>
                            Ver registro enviado
                          </summary>
                          <pre className="text-xs mt-1 p-2 rounded overflow-auto"
                            style={{ background: 'var(--cream)', color: 'var(--ink-soft)', maxHeight: 140 }}>
                            {JSON.stringify(r.primerRegistro, null, 2)}
                          </pre>
                        </details>
                      )}
                      {!r.success && r.columnasDisponibles?.length > 0 && (
                        <p className="text-xs mt-1 break-all" style={{ color: 'var(--ink-mute)' }}>
                          Columnas: {r.columnasDisponibles.join(' · ')}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          </div>
        )}

        {/* ── HISTORIAL ── */}
        {historial.length > 0 && (
          <div>
            <p className="text-xs font-bold tracking-wider mb-3" style={{ color: 'var(--ink-soft)' }}>
              ÚLTIMAS IMPORTACIONES
            </p>
            <div className="space-y-2">
              {historial.map((h, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between px-4 py-3 rounded-xl"
                  style={{ background: 'var(--paper)', border: '1px solid var(--line)' }}
                >
                  <p className="text-ink text-sm font-medium">{h.fecha}</p>
                  <div className="text-right">
                    <p className="text-ink text-sm font-bold">
                      ${(h.venta_bruta || 0).toFixed(0)}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--good-ink)' }}>
                      neto ${(h.ganancia_neta || 0).toFixed(0)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </main>
      <BottomNav />
    </div>
  );
}
