'use client';
import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Mic, MicOff } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { formatMXN } from '@/lib/calculos';

function parsearVoz(texto, productos, canal) {
  const t = texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const nuevasCantidades = {};
  const numeros = {
    'un ': 1, 'una ': 1, 'dos ': 2, 'tres ': 3, 'cuatro ': 4, 'cinco ': 5,
  };
  const aliases = {
    'doble bacon smash': 'Doble Bacon Smash',
    'bacos double smash': 'Doble Bacon Smash',
    'doble bacon': 'Doble Bacon Smash',
    'bacon doble': 'Doble Bacon Smash',
    'doble smash': 'Doble Smash',
    'double smash': 'Doble Smash',
    'doble': 'Doble Smash',
    'bacon smash': 'Bacon Smash',
    'bacon': 'Bacon Smash',
    'smash sencilla': 'Smash Sencilla',
    'sencilla': 'Smash Sencilla',
    'smash': 'Smash Sencilla',
  };
  const aliasesOrdenados = Object.keys(aliases).sort((a, b) => b.length - a.length);
  let textoRestante = ' ' + t + ' ';
  for (const alias of aliasesOrdenados) {
    const idx = textoRestante.indexOf(alias);
    if (idx === -1) continue;
    const nombreProducto = aliases[alias];
    const producto = productos.find(p => p.nombre === nombreProducto);
    if (!producto) continue;
    let cantidad = 1;
    const textoAntes = textoRestante.substring(0, idx);
    const matchDigito = textoAntes.match(/(\d+)\s*$/);
    if (matchDigito) {
      cantidad = parseInt(matchDigito[1]);
    } else {
      for (const [palabra, num] of Object.entries(numeros)) {
        if (textoAntes.includes(palabra)) { cantidad = num; break; }
      }
    }
    nuevasCantidades[producto.id] = (nuevasCantidades[producto.id] || 0) + cantidad;
    textoRestante = textoRestante.replace(alias, ' '.repeat(alias.length));
  }
  return nuevasCantidades;
}

function getPrecio(producto, canal) {
  if (canal === 'didi') return producto.precio_didi || producto.precio_venta;
  if (canal === 'whatsapp') return producto.precio_whatsapp || producto.precio_venta;
  return producto.precio_whatsapp || producto.precio_venta;
}

function getPrecioNeto(producto, canal) {
  if (canal === 'didi') return producto.precio_didi_neto || producto.precio_venta;
  return getPrecio(producto, canal);
}

// Promo Martes-Jueves: Smash Sencilla a $99
const PRECIO_PROMO = 99;
const DIA_HOY = new Date().getDay(); // 0=Dom, 1=Lun, 2=Mar, 3=Mié, 4=Jue
const ES_DIA_PROMO = DIA_HOY >= 2 && DIA_HOY <= 4;

export default function NuevoPedidoPage() {
  const router = useRouter();
  const [productos, setProductos] = useState([]);
  const [cantidades, setCantidades] = useState({});
  const [cliente, setCliente] = useState('');
  const [canal, setCanal] = useState('whatsapp');
  const [notas, setNotas] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [escuchando, setEscuchando] = useState(false);
  const [textoVoz, setTextoVoz] = useState('');
  const [vozEstado, setVozEstado] = useState('');
  // Promo: activa por defecto si es día de promo
  const [promoActiva, setPromoActiva] = useState(ES_DIA_PROMO);
  const recognitionRef = useRef(null);

  useEffect(() => {
    supabase.from('productos').select('*').eq('disponible', true).order('orden')
      .then(({ data }) => {
        if (data) {
          setProductos(data);
          const init = {};
          data.forEach((p) => (init[p.id] = 0));
          setCantidades(init);
        }
      });
  }, []);

  // Precio final aplicando promo si corresponde
  const getPrecioFinal = (producto, canalActual) => {
    if (
      promoActiva &&
      ES_DIA_PROMO &&
      producto.nombre === 'Smash Sencilla' &&
      canalActual !== 'didi'
    ) {
      return PRECIO_PROMO;
    }
    return getPrecio(producto, canalActual);
  };

  const iniciarVoz = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { alert('Usa Chrome en Android para reconocimiento de voz.'); return; }
    const recognition = new SpeechRecognition();
    recognition.lang = 'es-MX';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognitionRef.current = recognition;
    recognition.onstart = () => { setEscuchando(true); setVozEstado('escuchando'); setTextoVoz(''); if (navigator.vibrate) navigator.vibrate(100); };
    recognition.onresult = (event) => {
      const texto = event.results[0][0].transcript;
      setTextoVoz(texto);
      setVozEstado('procesando');
      const nuevasCantidades = parsearVoz(texto, productos, canal);
      if (Object.keys(nuevasCantidades).length > 0) {
        setCantidades(prev => { const u = { ...prev }; for (const [id, c] of Object.entries(nuevasCantidades)) u[id] = c; return u; });
        setVozEstado('listo');
        if (navigator.vibrate) navigator.vibrate([50, 50, 50]);
      } else { setVozEstado('error'); }
    };
    recognition.onerror = () => { setVozEstado('error'); setEscuchando(false); };
    recognition.onend = () => setEscuchando(false);
    recognition.start();
  };

  const detenerVoz = () => { recognitionRef.current?.stop(); setEscuchando(false); };
  const incrementar = (id) => setCantidades((prev) => ({ ...prev, [id]: (prev[id] || 0) + 1 }));
  const decrementar = (id) => setCantidades((prev) => ({ ...prev, [id]: Math.max(0, (prev[id] || 0) - 1) }));

  const total = productos.reduce((s, p) => s + (cantidades[p.id] || 0) * getPrecioFinal(p, canal), 0);
  const totalNeto = productos.reduce((s, p) => s + (cantidades[p.id] || 0) * getPrecioNeto(p, canal), 0);
  const itemsSeleccionados = productos.filter((p) => (cantidades[p.id] || 0) > 0);

  const guardar = async () => {
    if (itemsSeleccionados.length === 0) return;
    setGuardando(true);
    if (navigator.vibrate) navigator.vibrate(50);
    try {
      const ahora = new Date();
      const hora = ahora.toTimeString().slice(0, 8);
      const fecha = ahora.toISOString().split('T')[0];
      const negocio_id = productos[0]?.negocio_id;
      const { data: pedido, error: pedidoError } = await supabase
        .from('pedidos').insert({
          negocio_id, canal,
          cliente_nombre: cliente || null,
          notas: notas || null,
          estado: 'en_preparacion',
          total: canal === 'didi' ? totalNeto : total,
          fecha, hora,
        }).select().single();
      if (pedidoError) throw pedidoError;
      const items = itemsSeleccionados.map((p) => ({
        pedido_id: pedido.id,
        producto_id: p.id,
        cantidad: cantidades[p.id],
        precio: getPrecioFinal(p, canal),
        costo: p.costo_insumos,
      }));
      // Verificar errores en la inserción de items
      const { error: itemsError } = await supabase.from('pedido_items').insert(items);
      if (itemsError) throw itemsError;
      router.push('/');
    } catch (err) {
      console.error(err);
      alert('Error al guardar. Intenta de nuevo.');
    } finally { setGuardando(false); }
  };

  const vozColor = { escuchando: '#FF4D00', procesando: '#eab308', listo: '#22c55e', error: '#ef4444' }[vozEstado] || '#888';
  const vozMsg = { escuchando: '🎤 Escuchando...', procesando: '⚙️ Procesando...', listo: '✓ ' + textoVoz, error: '✗ No entendí. Intenta de nuevo.' }[vozEstado] || '';

  return (
    <div className="flex flex-col min-h-screen" style={{ background: '#0a0a0a' }}>
      <header className="sticky top-0 z-40 flex items-center gap-3 px-4 py-3" style={{ background: '#0a0a0a', borderBottom: '1px solid #1e1e1e' }}>
        <button onClick={() => router.back()} className="p-2 -ml-2 rounded-lg"><ArrowLeft size={22} /></button>
        <h1 className="font-bold text-lg">Nuevo pedido</h1>
      </header>

      <main className="flex-1 px-4 pt-4 pb-40 space-y-6">
        {/* Canal primero — afecta precios */}
        <section>
          <p className="text-xs font-bold tracking-wider mb-2" style={{ color: '#888' }}>CANAL</p>
          <div className="flex gap-2">
            {['whatsapp', 'didi', 'manual'].map((c) => (
              <button key={c} onClick={() => setCanal(c)} className="flex-1 py-3 rounded-xl font-bold text-sm"
                style={{ background: canal === c ? '#FF4D00' : '#141414', color: canal === c ? '#fff' : '#888', border: `1px solid ${canal === c ? '#FF4D00' : '#2a2a2a'}` }}>
                {c === 'whatsapp' ? 'WhatsApp' : c === 'didi' ? 'Didi' : 'Manual'}
              </button>
            ))}
          </div>
          {canal === 'didi' && (
            <p className="text-xs mt-2 px-1" style={{ color: '#666' }}>
              💡 Se registra el precio neto (lo que entra al banco)
            </p>
          )}
        </section>

        {/* Productos */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold tracking-wider" style={{ color: '#FF4D00' }}>¿QUÉ PIDIERON?</p>
            <button onClick={escuchando ? detenerVoz : iniciarVoz}
              className="flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-sm"
              style={{ background: escuchando ? '#FF4D00' : '#1e1e1e', color: '#fff', border: `2px solid ${escuchando ? '#FF4D00' : '#2a2a2a'}` }}>
              {escuchando ? <MicOff size={18} /> : <Mic size={18} />}
              {escuchando ? 'Detener' : 'Voz'}
            </button>
          </div>

          {/* Banner promo Martes-Jueves */}
          {ES_DIA_PROMO && canal !== 'didi' && (
            <div className="mb-3 flex items-center justify-between px-4 py-3 rounded-xl"
              style={{ background: promoActiva ? '#1a0800' : '#141414', border: `1px solid ${promoActiva ? '#FF4D0055' : '#2a2a2a'}` }}>
              <div>
                <p className="text-sm font-bold" style={{ color: promoActiva ? '#FF4D00' : '#888' }}>
                  🏷️ Promo Mar–Jue
                </p>
                <p className="text-xs mt-0.5" style={{ color: '#666' }}>
                  Smash Sencilla a $99
                </p>
              </div>
              <button
                onClick={() => setPromoActiva((prev) => !prev)}
                className="px-4 py-2 rounded-xl font-bold text-sm"
                style={{
                  background: promoActiva ? '#FF4D00' : '#2a2a2a',
                  color: promoActiva ? '#fff' : '#888',
                }}>
                {promoActiva ? 'Activa' : 'Inactiva'}
              </button>
            </div>
          )}

          {vozEstado && (
            <div className="px-4 py-3 rounded-xl mb-3 text-sm font-medium"
              style={{ background: `${vozColor}18`, color: vozColor, border: `1px solid ${vozColor}44` }}>
              {vozMsg}
            </div>
          )}
          <div className="space-y-2">
            {productos.map((p) => {
              const precio = getPrecioFinal(p, canal);
              const precioOriginal = getPrecio(p, canal);
              const precioNeto = getPrecioNeto(p, canal);
              const cant = cantidades[p.id] || 0;
              const esProductoPromo = promoActiva && ES_DIA_PROMO && p.nombre === 'Smash Sencilla' && canal !== 'didi';
              return (
                <div key={p.id} className="flex items-center justify-between p-4 rounded-2xl"
                  style={{ background: cant > 0 ? '#1a1a0a' : '#141414', border: `1px solid ${cant > 0 ? '#FF4D0044' : 'transparent'}` }}>
                  <div>
                    <p className="font-bold text-white">{p.nombre}</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-bold" style={{ color: esProductoPromo ? '#FF4D00' : '#888' }}>
                        {formatMXN(precio)}
                      </p>
                      {esProductoPromo && precioOriginal !== precio && (
                        <p className="text-xs line-through" style={{ color: '#555' }}>
                          {formatMXN(precioOriginal)}
                        </p>
                      )}
                      {canal === 'didi' && (
                        <p className="text-xs" style={{ color: '#22c55e' }}>neto {formatMXN(precioNeto)}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <button onClick={() => decrementar(p.id)} disabled={!cant}
                      className="w-11 h-11 rounded-full font-bold text-xl flex items-center justify-center"
                      style={{ background: cant ? '#2a2a2a' : '#1a1a1a', color: cant ? '#fff' : '#444' }}>−</button>
                    <span className="text-white font-bold text-lg w-6 text-center">{cant}</span>
                    <button onClick={() => incrementar(p.id)}
                      className="w-11 h-11 rounded-full font-bold text-xl flex items-center justify-center"
                      style={{ background: '#FF4D00', color: '#fff' }}>+</button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Cliente */}
        <section>
          <p className="text-xs font-bold tracking-wider mb-2" style={{ color: '#888' }}>CLIENTE (OPCIONAL)</p>
          <input type="text" value={cliente} onChange={(e) => setCliente(e.target.value)}
            placeholder="Nombre del cliente..."
            className="w-full px-4 py-3 rounded-xl text-white placeholder-zinc-600 outline-none"
            style={{ background: '#141414', border: '1px solid #2a2a2a', fontSize: 16 }} />
        </section>

        {/* Notas */}
        <section>
          <p className="text-xs font-bold tracking-wider mb-2" style={{ color: '#888' }}>NOTAS (OPCIONAL)</p>
          <input type="text" value={notas} onChange={(e) => setNotas(e.target.value)}
            placeholder="sin cebolla, extra salsa..."
            className="w-full px-4 py-3 rounded-xl text-white placeholder-zinc-600 outline-none"
            style={{ background: '#141414', border: '1px solid #2a2a2a', fontSize: 16 }} />
        </section>
      </main>

      <div className="fixed bottom-0 left-0 right-0 px-4 pt-3"
        style={{ background: '#0a0a0a', borderTop: '1px solid #1e1e1e', paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <span style={{ color: '#888', fontSize: 12 }}>TOTAL {canal === 'didi' ? '(neto)' : ''}</span>
            {canal === 'didi' && total !== totalNeto && (
              <p className="text-xs" style={{ color: '#666' }}>Plataforma: {formatMXN(total)}</p>
            )}
          </div>
          <span className="text-2xl font-bold text-white">{formatMXN(canal === 'didi' ? totalNeto : total)}</span>
        </div>
        <button onClick={guardar} disabled={itemsSeleccionados.length === 0 || guardando}
          className="w-full py-4 rounded-2xl font-bold text-lg"
          style={{ background: itemsSeleccionados.length === 0 ? '#1e1e1e' : '#FF4D00', color: itemsSeleccionados.length === 0 ? '#444' : '#fff' }}>
          {guardando ? 'Guardando...' : 'REGISTRAR PEDIDO'}
        </button>
      </div>
    </div>
  );
}
