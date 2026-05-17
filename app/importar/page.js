'use client';
import { useEffect, useState } from 'react';
import { Upload, FileSpreadsheet, CheckCircle, XCircle } from 'lucide-react';
import BottomNav from '@/components/BottomNav';
import { supabase } from '@/lib/supabase/client';

export default function ImportarPage() {
  const [estado, setEstado] = useState('idle'); // idle | subiendo | exito | error
  const [resultado, setResultado] = useState(null);
  const [historial, setHistorial] = useState([]);

  useEffect(() => {
    cargarHistorial();
  }, []);

  const cargarHistorial = async () => {
    const { data } = await supabase
      .from('importaciones_didi')
      .select('fecha, venta_bruta, ganancia_neta')
      .order('fecha', { ascending: false })
      .limit(10);

    if (data) {
      // Agrupar por semana aproximada
      setHistorial(data.slice(0, 5));
    }
  };

  const handleArchivo = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      alert('Por favor sube un archivo Excel (.xlsx o .xls)');
      return;
    }

    setEstado('subiendo');
    setResultado(null);

    try {
      const formData = new FormData();
      formData.append('archivo', file);

      const response = await fetch('/api/importar-didi', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (data.success) {
        setEstado('exito');
        setResultado(data);
        cargarHistorial();
      } else {
        setEstado('error');
        setResultado(data);
      }
    } catch (err) {
      setEstado('error');
      setResultado({ error: 'Error de conexión. Intenta de nuevo.' });
    }

    // Reset input
    e.target.value = '';
  };

  return (
    <div className="flex flex-col min-h-screen" style={{ background: '#0a0a0a' }}>
      <header
        className="sticky top-0 z-40 px-4 py-3"
        style={{ background: '#0a0a0a', borderBottom: '1px solid #1e1e1e' }}
      >
        <h1 className="font-bold text-lg">Importar reporte Didi</h1>
      </header>

      <main className="flex-1 px-4 pt-6 pb-32 space-y-6">
        {/* Upload area */}
        <div
          className="rounded-2xl p-8 text-center"
          style={{ background: '#141414', border: '2px dashed #2a2a2a' }}
        >
          <FileSpreadsheet
            size={48}
            className="mx-auto mb-4"
            style={{ color: estado === 'exito' ? '#22c55e' : '#FF4D00' }}
          />

          <p className="font-bold text-white mb-1">Sube tu reporte de DiDi</p>
          <p className="text-sm mb-1" style={{ color: '#888' }}>
            DiDi Tienda → Finanzas
          </p>
          <p className="text-sm mb-6" style={{ color: '#888' }}>
            → Enviar reporte → Detalle de pagos
          </p>

          <label className="cursor-pointer">
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={handleArchivo}
              className="hidden"
              disabled={estado === 'subiendo'}
            />
            <span
              className="inline-block px-8 py-4 rounded-xl font-bold text-white"
              style={{
                background: estado === 'subiendo' ? '#333' : '#FF4D00',
                opacity: estado === 'subiendo' ? 0.7 : 1,
              }}
            >
              {estado === 'subiendo' ? 'Procesando...' : 'SELECCIONAR ARCHIVO'}
            </span>
          </label>
        </div>

        {/* Resultado */}
        {estado === 'exito' && resultado && (
          <div className="rounded-2xl p-4" style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)' }}>
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle size={20} style={{ color: '#22c55e' }} />
              <span className="font-bold" style={{ color: '#22c55e' }}>
                {resultado.mensaje}
              </span>
            </div>
            {resultado.resumen && (
              <p className="text-sm" style={{ color: '#aaa' }}>
                Periodo: {resultado.resumen.periodo_inicio} al {resultado.resumen.periodo_fin}
              </p>
            )}
          </div>
        )}

        {estado === 'error' && resultado && (
          <div className="rounded-2xl p-4" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
            <div className="flex items-center gap-2 mb-2">
              <XCircle size={20} style={{ color: '#ef4444' }} />
              <span className="font-bold" style={{ color: '#ef4444' }}>
                {resultado.error || resultado.mensaje}
              </span>
            </div>
            {resultado.errores?.length > 0 && (
              <details className="mt-2">
                <summary className="text-sm cursor-pointer" style={{ color: '#888' }}>
                  Ver {resultado.errores.length} filas con error
                </summary>
                <pre
                  className="text-xs mt-2 p-3 rounded-xl overflow-auto"
                  style={{ background: '#0a0a0a', color: '#aaa', maxHeight: 200 }}
                >
                  {JSON.stringify(resultado.errores, null, 2)}
                </pre>
              </details>
            )}
          </div>
        )}

        {/* Historial */}
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
                  <div>
                    <p className="text-white text-sm font-medium">{h.fecha}</p>
                  </div>
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
