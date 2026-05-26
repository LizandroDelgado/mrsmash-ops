'use client';
import { useEffect, useState } from 'react';
import { Upload, FileSpreadsheet, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import BottomNav from '@/components/BottomNav';
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
    <div className="flex flex-col min-h-screen" style={{ background: '#0a0a0a' }}>
      <header
        className="sticky top-0 z-40 px-4 py-3"
        style={{ background: '#0a0a0a', borderBottom: '1px solid #1e1e1e' }}
      >
        <img src="/logo.png" alt="MR. SMASH" style={{ height: '36px', width: 'auto' }} />
      </header>

      <main className="flex-1 px-4 pt-6 pb-32 space-y-6">

        {/* ── ZONA DE UPLOAD ── */}
        <div
          className="rounded-2xl p-8 text-center"
          style={{ background: '#141414', border: '2px dashed #2a2a2a' }}
        >
          <FileSpreadsheet
            size={48}
            className="mx-auto mb-4"
            style={{ color: estado === 'terminado' ? '#22c55e' : '#FF4D00' }}
          />

          <p className="font-bold text-white mb-1">Sube tu reporte de DiDi</p>
          <p className="text-sm mb-1" style={{ color: '#888' }}>DiDi Tienda → Finanzas</p>
          <p className="text-sm mb-1" style={{ color: '#888' }}>→ Enviar reporte → Detalle de pagos</p>
          <p className="text-xs mb-6" style={{ color: '#555' }}>Puedes seleccionar varios archivos a la vez</p>

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
              className="inline-block px-8 py-4 rounded-xl font-bold text-white"
              style={{
                background: estado === 'procesando' ? '#333' : '#FF4D00',
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
            style={{ background: '#141414', border: '1px solid #2a2a2a' }}
          >
            {/* Texto de progreso */}
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-white">
                Procesando {progreso.actual} de {progreso.total}
              </p>
              <p className="text-sm font-bold" style={{ color: '#FF4D00' }}>{pctProgreso}%</p>
            </div>

            {/* Nombre del archivo actual */}
            <p className="text-xs truncate" style={{ color: '#888' }}>{progreso.nombre}</p>

            {/* Barra de progreso */}
            <div className="h-2 rounded-full overflow-hidden" style={{ background: '#2a2a2a' }}>
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{ width: `${pctProgreso}%`, background: '#FF4D00' }}
              />
            </div>

            {/* Mini lista de resultados en tiempo real */}
            {resultados.length > 0 && (
              <div className="space-y-1 pt-1">
                {resultados.map((r, i) => (
                  <div key={i} className="flex items-center gap-2">
                    {r.success
                      ? <CheckCircle size={13} style={{ color: '#22c55e', flexShrink: 0 }} />
                      : <XCircle    size={13} style={{ color: '#ef4444', flexShrink: 0 }} />
                    }
                    <span className="text-xs truncate" style={{ color: r.success ? '#aaa' : '#ef4444' }}>
                      {r.nombre}
                    </span>
                    {r.success && (
                      <span className="text-xs ml-auto whitespace-nowrap" style={{ color: '#666' }}>
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
                ? 'rgba(34,197,94,0.08)'
                : 'rgba(234,179,8,0.08)',
              border: `1px solid ${resumenFinal.archivosFallidos === 0
                ? 'rgba(34,197,94,0.2)'
                : 'rgba(234,179,8,0.2)'}`,
            }}
          >
            {/* Título */}
            <div className="flex items-center gap-2">
              {resumenFinal.archivosFallidos === 0
                ? <CheckCircle size={20} style={{ color: '#22c55e' }} />
                : <AlertCircle size={20} style={{ color: '#eab308' }} />
              }
              <span className="font-bold text-white">
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
                  style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}
                >
                  ✓ {resumenFinal.totalNuevos} nuevos
                </span>
              )}
              {resumenFinal.totalDuplicados > 0 && (
                <span
                  className="px-3 py-1 rounded-full text-xs font-bold"
                  style={{ background: 'rgba(234,179,8,0.15)', color: '#eab308' }}
                >
                  ⊘ {resumenFinal.totalDuplicados} ya existían
                </span>
              )}
              {resumenFinal.archivosFallidos > 0 && (
                <span
                  className="px-3 py-1 rounded-full text-xs font-bold"
                  style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}
                >
                  ✗ {resumenFinal.archivosFallidos} fallidos
                </span>
              )}
            </div>

            {/* Detalle por archivo */}
            <details>
              <summary
                className="text-xs cursor-pointer select-none"
                style={{ color: '#666' }}
              >
                Ver detalle por archivo
              </summary>
              <div className="mt-2 space-y-1">
                {resultados.map((r, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 py-1"
                    style={{ borderTop: i > 0 ? '1px solid #1e1e1e' : 'none' }}
                  >
                    {r.success
                      ? <CheckCircle size={13} style={{ color: '#22c55e', flexShrink: 0, marginTop: 2 }} />
                      : <XCircle    size={13} style={{ color: '#ef4444', flexShrink: 0, marginTop: 2 }} />
                    }
                    <div className="flex-1 min-w-0">
                      <p className="text-xs truncate" style={{ color: '#ccc' }}>{r.nombre}</p>
                      <p className="text-xs" style={{ color: r.success ? '#666' : '#ef4444' }}>
                        {r.mensaje}
                      </p>
                      {!r.success && r.errorCode && (
                        <p className="text-xs mt-0.5 font-mono" style={{ color: '#f97316' }}>
                          code: {r.errorCode}{r.errorHint ? ` · ${r.errorHint}` : ''}
                        </p>
                      )}
                      {!r.success && r.primerRegistro && (
                        <details className="mt-1">
                          <summary className="text-xs cursor-pointer" style={{ color: '#555' }}>
                            Ver registro enviado
                          </summary>
                          <pre className="text-xs mt-1 p-2 rounded overflow-auto"
                            style={{ background: '#0a0a0a', color: '#aaa', maxHeight: 140 }}>
                            {JSON.stringify(r.primerRegistro, null, 2)}
                          </pre>
                        </details>
                      )}
                      {!r.success && r.columnasDisponibles?.length > 0 && (
                        <p className="text-xs mt-1 break-all" style={{ color: '#555' }}>
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
            <p className="text-xs font-bold tracking-wider mb-3" style={{ color: '#888' }}>
              ÚLTIMAS IMPORTACIONES
            </p>
            <div className="space-y-2">
              {historial.map((h, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between px-4 py-3 rounded-xl"
                  style={{ background: '#141414' }}
                >
                  <p className="text-white text-sm font-medium">{h.fecha}</p>
                  <div className="text-right">
                    <p className="text-white text-sm font-bold">
                      ${(h.venta_bruta || 0).toFixed(0)}
                    </p>
                    <p className="text-xs" style={{ color: '#22c55e' }}>
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
