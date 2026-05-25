'use client';
import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import BottomNav from '@/components/BottomNav';
import { supabase } from '@/lib/supabase/client';
import { formatMXN, getInicioSemana } from '@/lib/calculos';

const CATEGORIAS = ['Carne', 'Pan', 'Verdura', 'Salsas', 'Empaque', 'Otro'];

export default function InsumosPage() {
  const [descripcion, setDescripcion] = useState('');
  const [monto, setMonto] = useState('');
  const [categoria, setCategoria] = useState('');
  const [fechaOpt, setFechaOpt] = useState('hoy');
  const [guardando, setGuardando] = useState(false);
  const [compras, setCompras] = useState([]);
  const [negocioId, setNegocioId] = useState(null);
  const [confirmEliminar, setConfirmEliminar] = useState(null);

  useEffect(() => {
    supabase
      .from('productos')
      .select('negocio_id')
      .limit(1)
      .single()
      .then(({ data }) => {
        if (data?.negocio_id) {
          setNegocioId(data.negocio_id);
          cargarCompras(data.negocio_id);
        }
      });
  }, []);

  const cargarCompras = async (nid) => {
    const inicio = getInicioSemana();
    const { data } = await supabase
      .from('compras_insumos')
      .select('*')
      .eq('negocio_id', nid)
      .gte('fecha', inicio)
      .order('created_at', { ascending: false });
    if (data) setCompras(data);
  };

  const getFecha = () => {
    const hoy = new Date();
    if (fechaOpt === 'hoy') return hoy.toISOString().split('T')[0];
    if (fechaOpt === 'ayer') {
      hoy.setDate(hoy.getDate() - 1);
      return hoy.toISOString().split('T')[0];
    }
    return hoy.toISOString().split('T')[0];
  };

  const guardar = async () => {
    if (!descripcion || !monto || !negocioId) return;
    setGuardando(true);
    if (navigator.vibrate) navigator.vibrate(50);

    const { error } = await supabase.from('compras_insumos').insert({
      negocio_id: negocioId,
      descripcion,
      monto: parseFloat(monto),
      categoria: categoria || 'Otro',
      fecha: getFecha(),
    });

    if (!error) {
      setDescripcion('');
      setMonto('');
      setCategoria('');
      cargarCompras(negocioId);
    } else {
      alert('Error al guardar. Intenta de nuevo.');
    }
    setGuardando(false);
  };

  const eliminarCompra = async (id) => {
    // Eliminar via API route (usa service role key)
    const res = await fetch(`/api/insumos?id=${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert('Error al eliminar: ' + (err.error || res.status));
      return;
    }
    // Solo actualizar estado local si Supabase confirmó la eliminación
    setCompras((prev) => prev.filter((c) => c.id !== id));
    setConfirmEliminar(null);
    if (navigator.vibrate) navigator.vibrate(100);
  };

  const totalSemana = compras.reduce((s, c) => s + c.monto, 0);

  return (
    <div className="flex flex-col min-h-screen" style={{ background: '#0a0a0a' }}>
      <header
        className="sticky top-0 z-40 flex items-center gap-3 px-4 py-3"
        style={{ background: '#0a0a0a', borderBottom: '1px solid #1e1e1e' }}
      >
        <h1 className="font-bold text-lg">Registrar compra</h1>
      </header>

      <main className="flex-1 px-4 pt-4 pb-32 space-y-5">
        {/* Descripción */}
        <div>
          <p className="text-xs font-bold tracking-wider mb-2" style={{ color: '#FF4D00' }}>
            ¿QUÉ COMPRASTE?
          </p>
          <input
            type="text"
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder="Carne 5kg, pan 30 piezas..."
            className="w-full px-4 py-3 rounded-xl text-white placeholder-zinc-600 outline-none"
            style={{ background: '#141414', border: '1px solid #2a2a2a', fontSize: 16 }}
          />
        </div>

        {/* Monto */}
        <div>
          <p className="text-xs font-bold tracking-wider mb-2" style={{ color: '#888' }}>
            ¿CUÁNTO PAGASTE?
          </p>
          <div className="relative">
            <span
              className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-lg"
              style={{ color: '#888' }}
            >
              $
            </span>
            <input
              type="number"
              inputMode="decimal"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              placeholder="0"
              className="w-full pl-10 pr-4 py-3 rounded-xl text-white placeholder-zinc-600 outline-none text-xl font-bold"
              style={{ background: '#141414', border: '1px solid #2a2a2a', fontSize: 20 }}
            />
          </div>
        </div>

        {/* Categoría */}
        <div>
          <p className="text-xs font-bold tracking-wider mb-2" style={{ color: '#888' }}>
            CATEGORÍA
          </p>
          <div className="flex flex-wrap gap-2">
            {CATEGORIAS.map((cat) => (
              <button
                key={cat}
                onClick={() => setCategoria(cat)}
                className="px-4 py-2 rounded-xl font-medium text-sm"
                style={{
                  background: categoria === cat ? '#FF4D00' : '#141414',
                  color: categoria === cat ? '#fff' : '#888',
                  border: `1px solid ${categoria === cat ? '#FF4D00' : '#2a2a2a'}`,
                }}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Fecha */}
        <div>
          <p className="text-xs font-bold tracking-wider mb-2" style={{ color: '#888' }}>
            FECHA
          </p>
          <div className="flex gap-2">
            {['hoy', 'ayer'].map((f) => (
              <button
                key={f}
                onClick={() => setFechaOpt(f)}
                className="flex-1 py-3 rounded-xl font-bold text-sm capitalize"
                style={{
                  background: fechaOpt === f ? '#FF4D00' : '#141414',
                  color: fechaOpt === f ? '#fff' : '#888',
                  border: `1px solid ${fechaOpt === f ? '#FF4D00' : '#2a2a2a'}`,
                }}
              >
                {f === 'hoy' ? 'Hoy' : 'Ayer'}
              </button>
            ))}
          </div>
        </div>

        {/* Botón guardar */}
        <button
          onClick={guardar}
          disabled={!descripcion || !monto || guardando}
          className="w-full py-4 rounded-2xl font-bold text-lg"
          style={{
            background: descripcion && monto ? '#FF4D00' : '#1e1e1e',
            color: descripcion && monto ? '#fff' : '#444',
          }}
        >
          {guardando ? 'Guardando...' : 'GUARDAR COMPRA'}
        </button>

        {/* Lista semana actual */}
        {compras.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-bold tracking-wider" style={{ color: '#888' }}>
                ESTA SEMANA
              </p>
              <p className="font-bold text-white">{formatMXN(totalSemana)}</p>
            </div>
            <div className="space-y-2">
              {compras.map((c) => (
                <div key={c.id} className="rounded-xl overflow-hidden" style={{ background: '#141414' }}>
                  {/* Fila principal */}
                  <div className="flex items-center justify-between px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium truncate">{c.descripcion}</p>
                      <p className="text-xs" style={{ color: '#666' }}>
                        {c.categoria} · {c.fecha}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 ml-3">
                      <span className="font-bold text-white">{formatMXN(c.monto)}</span>
                      <button
                        onClick={() => setConfirmEliminar(confirmEliminar === c.id ? null : c.id)}
                        className="p-2 rounded-lg"
                        style={{ background: confirmEliminar === c.id ? '#ef444422' : '#1e1e1e' }}
                      >
                        <Trash2 size={15} style={{ color: confirmEliminar === c.id ? '#ef4444' : '#555' }} />
                      </button>
                    </div>
                  </div>

                  {/* Confirmación de eliminación */}
                  {confirmEliminar === c.id && (
                    <div className="flex gap-2 px-4 pb-3">
                      <button
                        onClick={() => setConfirmEliminar(null)}
                        className="flex-1 py-2 rounded-xl text-sm font-bold"
                        style={{ background: '#1e1e1e', color: '#888' }}
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={() => eliminarCompra(c.id)}
                        className="flex-1 py-2 rounded-xl text-sm font-bold"
                        style={{ background: '#ef444422', color: '#ef4444' }}
                      >
                        Confirmar borrar
                      </button>
                    </div>
                  )}
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
