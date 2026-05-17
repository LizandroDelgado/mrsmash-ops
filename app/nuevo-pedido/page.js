'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { formatMXN } from '@/lib/calculos';

export default function NuevoPedidoPage() {
  const router = useRouter();
  const [productos, setProductos] = useState([]);
  const [cantidades, setCantidades] = useState({});
  const [cliente, setCliente] = useState('');
  const [canal, setCanal] = useState('whatsapp');
  const [notas, setNotas] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    supabase
      .from('productos')
      .select('*')
      .eq('disponible', true)
      .order('orden')
      .then(({ data }) => {
        if (data) {
          setProductos(data);
          const init = {};
          data.forEach((p) => (init[p.id] = 0));
          setCantidades(init);
        }
      });
  }, []);

  const incrementar = (id) =>
    setCantidades((prev) => ({ ...prev, [id]: (prev[id] || 0) + 1 }));

  const decrementar = (id) =>
    setCantidades((prev) => ({ ...prev, [id]: Math.max(0, (prev[id] || 0) - 1) }));

  const total = productos.reduce(
    (s, p) => s + (cantidades[p.id] || 0) * p.precio_venta,
    0
  );

  const itemsSeleccionados = productos.filter((p) => (cantidades[p.id] || 0) > 0);

  const guardar = async () => {
    if (itemsSeleccionados.length === 0) return;
    setGuardando(true);
    if (navigator.vibrate) navigator.vibrate(50);

    try {
      const ahora = new Date();
      const hora = ahora.toTimeString().slice(0, 8);
      const fecha = ahora.toISOString().split('T')[0];

      // Obtener negocio_id del primer producto (todos son del mismo negocio)
      const negocio_id = productos[0]?.negocio_id;

      const { data: pedido, error: pedidoError } = await supabase
        .from('pedidos')
        .insert({
          negocio_id,
          canal,
          cliente_nombre: cliente || null,
          notas: notas || null,
          estado: 'en_preparacion',
          total,
          fecha,
          hora,
        })
        .select()
        .single();

      if (pedidoError) throw pedidoError;

      const items = itemsSeleccionados.map((p) => ({
        pedido_id: pedido.id,
        producto_id: p.id,
        cantidad: cantidades[p.id],
        precio: p.precio_venta,
        costo: p.costo_insumos,
      }));

      await supabase.from('pedido_items').insert(items);

      router.push('/');
    } catch (err) {
      console.error(err);
      alert('Error al guardar. Intenta de nuevo.');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="flex flex-col min-h-screen" style={{ background: '#0a0a0a' }}>
      <header
        className="sticky top-0 z-40 flex items-center gap-3 px-4 py-3"
        style={{ background: '#0a0a0a', borderBottom: '1px solid #1e1e1e' }}
      >
        <button onClick={() => router.back()} className="p-2 -ml-2 rounded-lg">
          <ArrowLeft size={22} />
        </button>
        <h1 className="font-bold text-lg">Nuevo pedido</h1>
      </header>

      <main className="flex-1 px-4 pt-4 pb-40 space-y-6">
        {/* Productos */}
        <section>
          <p className="text-xs font-bold tracking-wider mb-3" style={{ color: '#FF4D00' }}>
            ¿QUÉ PIDIERON?
          </p>
          <div className="space-y-2">
            {productos.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between p-4 rounded-2xl"
                style={{ background: '#141414' }}
              >
                <div>
                  <p className="font-bold text-white">{p.nombre}</p>
                  <p className="text-sm" style={{ color: '#888' }}>{formatMXN(p.precio_venta)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => decrementar(p.id)}
                    disabled={!cantidades[p.id]}
                    className="w-11 h-11 rounded-full font-bold text-xl flex items-center justify-center"
                    style={{
                      background: cantidades[p.id] ? '#2a2a2a' : '#1a1a1a',
                      color: cantidades[p.id] ? '#fff' : '#444',
                    }}
                  >
                    −
                  </button>
                  <span className="text-white font-bold text-lg w-6 text-center">
                    {cantidades[p.id] || 0}
                  </span>
                  <button
                    onClick={() => incrementar(p.id)}
                    className="w-11 h-11 rounded-full font-bold text-xl flex items-center justify-center"
                    style={{ background: '#FF4D00', color: '#fff' }}
                  >
                    +
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Cliente */}
        <section>
          <p className="text-xs font-bold tracking-wider mb-2" style={{ color: '#888' }}>
            CLIENTE (OPCIONAL)
          </p>
          <input
            type="text"
            value={cliente}
            onChange={(e) => setCliente(e.target.value)}
            placeholder="Nombre del cliente..."
            className="w-full px-4 py-3 rounded-xl text-white placeholder-zinc-600 outline-none"
            style={{ background: '#141414', border: '1px solid #2a2a2a', fontSize: 16 }}
          />
        </section>

        {/* Canal */}
        <section>
          <p className="text-xs font-bold tracking-wider mb-2" style={{ color: '#888' }}>
            CANAL
          </p>
          <div className="flex gap-2">
            {['whatsapp', 'didi', 'manual'].map((c) => (
              <button
                key={c}
                onClick={() => setCanal(c)}
                className="flex-1 py-3 rounded-xl font-bold text-sm capitalize"
                style={{
                  background: canal === c ? '#FF4D00' : '#141414',
                  color: canal === c ? '#fff' : '#888',
                  border: `1px solid ${canal === c ? '#FF4D00' : '#2a2a2a'}`,
                }}
              >
                {c === 'whatsapp' ? 'WhatsApp' : c === 'didi' ? 'Didi' : 'Manual'}
              </button>
            ))}
          </div>
        </section>

        {/* Notas */}
        <section>
          <p className="text-xs font-bold tracking-wider mb-2" style={{ color: '#888' }}>
            NOTAS (OPCIONAL)
          </p>
          <input
            type="text"
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            placeholder="sin cebolla, extra salsa..."
            className="w-full px-4 py-3 rounded-xl text-white placeholder-zinc-600 outline-none"
            style={{ background: '#141414', border: '1px solid #2a2a2a', fontSize: 16 }}
          />
        </section>
      </main>

      {/* Footer fijo con total y botón */}
      <div
        className="fixed bottom-0 left-0 right-0 px-4 pt-3"
        style={{
          background: '#0a0a0a',
          borderTop: '1px solid #1e1e1e',
          paddingBottom: 'max(20px, env(safe-area-inset-bottom))',
        }}
      >
        <div className="flex items-center justify-between mb-3">
          <span style={{ color: '#888' }}>TOTAL</span>
          <span className="text-2xl font-bold text-white">{formatMXN(total)}</span>
        </div>
        <button
          onClick={guardar}
          disabled={itemsSeleccionados.length === 0 || guardando}
          className="w-full py-4 rounded-2xl font-bold text-lg"
          style={{
            background: itemsSeleccionados.length === 0 ? '#1e1e1e' : '#FF4D00',
            color: itemsSeleccionados.length === 0 ? '#444' : '#fff',
          }}
        >
          {guardando ? 'Guardando...' : 'REGISTRAR PEDIDO'}
        </button>
      </div>
    </div>
  );
}
