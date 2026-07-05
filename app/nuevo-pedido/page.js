'use client';
import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Mic, MicOff } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { formatMXN, getFechaOperativa } from '@/lib/calculos';

function parsearVoz(texto, productos) {
  const t = texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const nuevasCantidades = {};
  const numeros = { 'un ': 1, 'una ': 1, 'dos ': 2, 'tres ': 3, 'cuatro ': 4, 'cinco ': 5 };
  const aliases = {
    // ── Hamburguesas ──────────────────────────────────────────────────────
    'doble bacon smash': 'Doble Bacon Smash',
    'bacos double smash': 'Doble Bacon Smash',
    'doble bacon': 'Doble Bacon Smash',
    'bacon doble': 'Doble Bacon Smash',
    'doble smash': 'Doble Smash',
    'double smash': 'Doble Smash',
    'doble': 'Doble Smash',
    'bacon smash': 'Bacon Smash',
    'bacon': 'Bacon Smash',
    'smash sencilla promo': 'Smash Sencilla Promo',
    'sencilla promo': 'Smash Sencilla Promo',
    'smash promo': 'Smash Sencilla Promo',
    'promo': 'Smash Sencilla Promo',
    'smash sencilla': 'Smash Sencilla',
    'sencilla': 'Smash Sencilla',
    'smash': 'Smash Sencilla',
    // ── Malteadas ─────────────────────────────────────────────────────────
    'malteada vainilla': 'Malteada Vainilla',
    'vainilla': 'Malteada Vainilla',
    'malteada fresa': 'Malteada Fresa',
    'fresa': 'Malteada Fresa',
    'malteada chocolate': 'Malteada Chocolate',
    'chocolate': 'Malteada Chocolate',
    // ── Papas ─────────────────────────────────────────────────────────────
    'papas smash': 'Papas Smash',
    'papas a la francesa': 'Papas a la francesa',
    'papas francesas': 'Papas a la francesa',
    'papas': 'Papas a la francesa',
    // ── Bebidas ───────────────────────────────────────────────────────────
    'refresco': 'Refresco',
    'soda': 'Refresco',
  };
  const aliasesOrdenados = Object.keys(aliases).sort((a, b) => b.length - a.length);
  let textoRestante = ' ' + t + ' ';
  for (const alias of aliasesOrdenados) {
    const idx = textoRestante.indexOf(alias);
    if (idx === -1) continue;
    const producto = productos.find((p) => p.nombre === aliases[alias]);
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
  if (canal === 'didi')      return producto.precio_didi     || producto.precio_venta;
  if (canal === 'whatsapp')  return producto.precio_whatsapp || producto.precio_venta;
  return producto.precio_whatsapp || producto.precio_venta;
}

function getPrecioNeto(producto, canal) {
  if (canal === 'didi') return producto.precio_didi_neto || producto.precio_venta;
  return getPrecio(producto, canal);
}

export default function NuevoPedidoPage() {
  const router = useRouter();
  const [productos,          setProductos]          = useState([]);
  const [cantidades,         setCantidades]         = useState({});
  const [cliente,            setCliente]            = useState('');
  const [canal,              setCanal]              = useState('whatsapp');
  const [notas,              setNotas]              = useState('');
  const [guardando,          setGuardando]          = useState(false);
  const [escuchando,         setEscuchando]         = useState(false);
  const [textoVoz,           setTextoVoz]           = useState('');
  const [vozEstado,          setVozEstado]          = useState('');
  // Fecha del pedido
  const [fechaOpt,           setFechaOpt]           = useState('hoy');
  const [fechaPersonalizada, setFechaPersonalizada] = useState('');
  const recognitionRef = useRef(null);

  const hoyStr         = new Date().toISOString().split('T')[0];
  const fechaOperativa = getFechaOperativa();
  const esMadrugada    = (() => { const a = new Date(); return a.getHours() * 60 + a.getMinutes() <= 180; })();
  const avisoFechaText = (() => {
    const d = new Date(fechaOperativa + 'T12:00:00');
    const dias  = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
    const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
    return `${dias[d.getDay()]} ${d.getDate()} de ${meses[d.getMonth()]}`;
  })();

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

  const getFechaFinal = () => {
    if (fechaOpt === 'hoy')  return fechaOperativa;
    if (fechaOpt === 'ayer') {
      const ayer = new Date(); ayer.setDate(ayer.getDate() - 1);
      return ayer.toISOString().split('T')[0];
    }
    return fechaPersonalizada || fechaOperativa;
  };

  const iniciarVoz = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { alert('Usa Chrome en Android para reconocimiento de voz.'); return; }
    const recognition = new SpeechRecognition();
    recognition.lang = 'es-MX';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognitionRef.current = recognition;
    recognition.onstart  = () => { setEscuchando(true); setVozEstado('escuchando'); setTextoVoz(''); if (navigator.vibrate) navigator.vibrate(100); };
    recognition.onresult = (event) => {
      const texto = event.results[0][0].transcript;
      setTextoVoz(texto);
      setVozEstado('procesando');
      const nuevas = parsearVoz(texto, productos);
      if (Object.keys(nuevas).length > 0) {
        setCantidades((prev) => { const u = { ...prev }; for (const [id, c] of Object.entries(nuevas)) u[id] = c; return u; });
        setVozEstado('listo');
        if (navigator.vibrate) navigator.vibrate([50, 50, 50]);
      } else { setVozEstado('error'); }
    };
    recognition.onerror = () => { setVozEstado('error'); setEscuchando(false); };
    recognition.onend   = () => setEscuchando(false);
    recognition.start();
  };

  const detenerVoz   = () => { recognitionRef.current?.stop(); setEscuchando(false); };
  const incrementar  = (id) => setCantidades((prev) => ({ ...prev, [id]: (prev[id] || 0) + 1 }));
  const decrementar  = (id) => setCantidades((prev) => ({ ...prev, [id]: Math.max(0, (prev[id] || 0) - 1) }));

  const total             = productos.reduce((s, p) => s + (cantidades[p.id] || 0) * getPrecio(p, canal), 0);
  const totalNeto         = productos.reduce((s, p) => s + (cantidades[p.id] || 0) * getPrecioNeto(p, canal), 0);
  const itemsSeleccionados = productos.filter((p) => (cantidades[p.id] || 0) > 0);

  const guardar = async () => {
    if (itemsSeleccionados.length === 0) return;
    if (fechaOpt === 'otra' && !fechaPersonalizada) return;
    setGuardando(true);
    if (navigator.vibrate) navigator.vibrate(50);
    try {
      const ahora      = new Date();
      const hora       = ahora.toTimeString().slice(0, 8);
      const fecha      = getFechaFinal();
      const negocio_id = productos[0]?.negocio_id;

      const { data: pedido, error: pedidoError } = await supabase
        .from('pedidos').insert({
          negocio_id, canal,
          cliente_nombre: cliente || null,
          notas:          notas   || null,
          estado:         'en_preparacion',
          total:          canal === 'didi' ? totalNeto : total,
          fecha, hora,
        }).select().single();
      if (pedidoError) throw pedidoError;

      const items = itemsSeleccionados.map((p) => ({
        pedido_id:   pedido.id,
        producto_id: p.id,
        cantidad:    cantidades[p.id],
        precio:      getPrecio(p, canal),
        costo:       p.costo_insumos,
      }));
      const { error: itemsError } = await supabase.from('pedido_items').insert(items);
      if (itemsError) throw itemsError;

      router.push('/');
    } catch (err) {
      console.error(err);
      alert('Error al guardar. Intenta de nuevo.');
    } finally { setGuardando(false); }
  };

  const vozColor = { escuchando: '#FF4D00', procesando: '#eab308', listo: '#22c55e', error: '#ef4444' }[vozEstado] || '#888';
  const vozMsg   = { escuchando: '🎤 Escuchando...', procesando: '⚙️ Procesando...', listo: '✓ ' + textoVoz, error: '✗ No entendí. Intenta de nuevo.' }[vozEstado] || '';

  return (
    <div className="flex flex-col min-h-screen" style={{ background: '#0a0a0a' }}>
      <header className="sticky top-0 z-40 flex items-center gap-3 px-4 py-3"
        style={{ background: '#0a0a0a', borderBottom: '1px solid #1e1e1e' }}>
        <button onClick={() => router.back()} className="p-2 -ml-2 rounded-lg">
          <ArrowLeft size={22} />
        </button>
        <img src="/logo.png" alt="MR. SMASH" style={{ height: '36px', width: 'auto' }} />
      </header>

      <main className="flex-1 px-4 pt-4 pb-40 space-y-6">

        {/* ── CANAL ── */}
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

        {/* ── PRODUCTOS ── */}
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

          {vozEstado && (
            <div className="px-4 py-3 rounded-xl mb-3 text-sm font-medium"
              style={{ background: `${vozColor}18`, color: vozColor, border: `1px solid ${vozColor}44` }}>
              {vozMsg}
            </div>
          )}

          <div className="space-y-2">
            {productos.map((p) => {
              const precio    = getPrecio(p, canal);
              const precioNeto = getPrecioNeto(p, canal);
              const cant      = cantidades[p.id] || 0;
              return (
                <div key={p.id} className="flex items-center justify-between p-4 rounded-2xl"
                  style={{ background: cant > 0 ? '#1a1a0a' : '#141414', border: `1px solid ${cant > 0 ? '#FF4D0044' : 'transparent'}` }}>
                  <div>
                    <p className="font-bold text-white">{p.nombre}</p>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold" style={{ color: '#888' }}>
                        {formatMXN(precio)}
                      </p>
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

        {/* ── CLIENTE ── */}
        <section>
          <p className="text-xs font-bold tracking-wider mb-2" style={{ color: '#888' }}>CLIENTE (OPCIONAL)</p>
          <input type="text" value={cliente} onChange={(e) => setCliente(e.target.value)}
            placeholder="Nombre del cliente..."
            className="w-full px-4 py-3 rounded-xl text-white placeholder-zinc-600 outline-none"
            style={{ background: '#141414', border: '1px solid #2a2a2a', fontSize: 16 }} />
        </section>

        {/* ── NOTAS ── */}
        <section>
          <p className="text-xs font-bold tracking-wider mb-2" style={{ color: '#888' }}>NOTAS (OPCIONAL)</p>
          <input type="text" value={notas} onChange={(e) => setNotas(e.target.value)}
            placeholder="sin cebolla, extra salsa..."
            className="w-full px-4 py-3 rounded-xl text-white placeholder-zinc-600 outline-none"
            style={{ background: '#141414', border: '1px solid #2a2a2a', fontSize: 16 }} />
        </section>

        {/* ── FECHA DEL PEDIDO ── */}
        <section>
          <p className="text-xs font-bold tracking-wider mb-2" style={{ color: '#888' }}>FECHA DEL PEDIDO</p>
          <div className="flex gap-2">
            {[
              { key: 'hoy',  label: 'Hoy'  },
              { key: 'ayer', label: 'Ayer' },
              { key: 'otra', label: '📅 Otra' },
            ].map(({ key, label }) => (
              <button key={key} onClick={() => setFechaOpt(key)}
                className="flex-1 py-3 rounded-xl font-bold text-sm"
                style={{
                  background: fechaOpt === key ? '#FF4D00' : '#141414',
                  color:      fechaOpt === key ? '#fff'    : '#888',
                  border:     `1px solid ${fechaOpt === key ? '#FF4D00' : '#2a2a2a'}`,
                }}>
                {label}
              </button>
            ))}
          </div>
          {fechaOpt === 'otra' && (
            <input
              type="date"
              value={fechaPersonalizada}
              max={hoyStr}
              onChange={(e) => setFechaPersonalizada(e.target.value)}
              className="mt-2 w-full px-4 py-3 rounded-xl text-white outline-none"
              style={{ background: '#141414', border: '1px solid #FF4D00', fontSize: 16, colorScheme: 'dark' }}
            />
          )}
          {esMadrugada && fechaOpt === 'hoy' && (
            <p className="text-xs mt-2 px-1" style={{ color: '#FF4D00' }}>
              📅 Se registrará para el {avisoFechaText}
            </p>
          )}
        </section>

      </main>

      {/* ── Footer fijo: total + botón guardar ── */}
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
        <button onClick={guardar}
          disabled={itemsSeleccionados.length === 0 || guardando || (fechaOpt === 'otra' && !fechaPersonalizada)}
          className="w-full py-4 rounded-2xl font-bold text-lg"
          style={{
            background: (itemsSeleccionados.length === 0 || (fechaOpt === 'otra' && !fechaPersonalizada)) ? '#1e1e1e' : '#FF4D00',
            color:      (itemsSeleccionados.length === 0 || (fechaOpt === 'otra' && !fechaPersonalizada)) ? '#444'    : '#fff',
          }}>
          {guardando ? 'Guardando...' : 'REGISTRAR PEDIDO'}
        </button>
      </div>
    </div>
  );
}
