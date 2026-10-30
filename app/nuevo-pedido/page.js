'use client';
import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Mic, MicOff } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { formatMXN } from '@/lib/calculos';
import { diaOperativo, sumarDias } from '@/lib/dia';
import { METODOS_VENTA } from '@/lib/negocio';
import { Header } from '@/components/ui';

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
  return producto.precio_salon || producto.precio_whatsapp || producto.precio_venta;   // salón
}

function getPrecioNeto(producto, canal) {
  // Lo que Didi deposita (comisión + promos + retenciones): es lo que entra a Didi por cobrar
  if (canal === 'didi') return producto.precio_didi_cobro || producto.precio_didi_neto || producto.precio_venta;
  return getPrecio(producto, canal);
}

export default function NuevoPedidoPage() {
  const router = useRouter();
  const [productos,          setProductos]          = useState([]);
  const [cantidades,         setCantidades]         = useState({});
  const [cliente,            setCliente]            = useState('');
  const [canal,              setCanal]              = useState('whatsapp');
  const [metodoPago,         setMetodoPago]         = useState('efectivo');
  const [notas,              setNotas]              = useState('');
  const [guardando,          setGuardando]          = useState(false);
  const [escuchando,         setEscuchando]         = useState(false);
  const [textoVoz,           setTextoVoz]           = useState('');
  const [vozEstado,          setVozEstado]          = useState('');
  // Fecha del pedido
  const [fechaOpt,           setFechaOpt]           = useState('hoy');
  const [fechaPersonalizada, setFechaPersonalizada] = useState('');
  const recognitionRef = useRef(null);

  // Día operativo (Tepic, corte 05:00): un pedido de las 23:30 o la 01:00 es de "hoy"
  const hoyStr = diaOperativo();

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
    if (fechaOpt === 'hoy')  return hoyStr;
    if (fechaOpt === 'ayer') return sumarDias(hoyStr, -1);
    return fechaPersonalizada || hoyStr;
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
          total_bruto:    canal === 'didi' ? total : null,
          metodo_pago:    canal === 'didi' ? 'didi' : metodoPago,
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

  const vozColor = { escuchando: 'var(--orange)', procesando: 'var(--warn-ink)', listo: 'var(--good-ink)', error: 'var(--bad-ink)' }[vozEstado] || 'var(--ink-soft)';
  const vozMsg   = { escuchando: '🎤 Escuchando...', procesando: '⚙️ Procesando...', listo: '✓ ' + textoVoz, error: '✗ No entendí. Intenta de nuevo.' }[vozEstado] || '';

  return (
    <div className="flex flex-col min-h-screen" style={{ background: 'var(--cream)' }}>
      <Header titulo="Nuevo pedido" back={() => router.back()} />

      <main className="flex-1 px-4 pt-4 pb-40 space-y-6">

        {/* ── CANAL ── */}
        <section>
          <p className="text-xs font-bold tracking-wider mb-2" style={{ color: 'var(--ink-soft)' }}>CANAL</p>
          <div className="flex gap-2">
            {['whatsapp', 'salon', 'didi'].map((c) => (
              <button key={c} onClick={() => setCanal(c)} className="flex-1 py-3 rounded-full font-bold text-sm"
                style={{ background: canal === c ? 'var(--orange-fill)' : 'var(--paper)', color: canal === c ? 'var(--on-orange)' : 'var(--ink-soft)', border: `1px solid ${canal === c ? 'var(--orange-fill)' : 'var(--line)'}` }}>
                {c === 'whatsapp' ? 'WhatsApp' : c === 'didi' ? 'Didi' : 'Salón'}
              </button>
            ))}
          </div>
          {canal === 'didi' ? (
            <p className="text-xs mt-2 px-1" style={{ color: 'var(--ink-mute)' }}>
              💡 Se registra el precio neto (lo que entra al banco)
            </p>
          ) : (
            <div className="flex gap-2 mt-2">
              {METODOS_VENTA.map(({ key, label }) => (
                <button key={key} onClick={() => setMetodoPago(key)} className="flex-1 py-3 rounded-full font-bold text-sm"
                  style={{ background: metodoPago === key ? 'var(--orange-soft)' : 'var(--paper)', color: metodoPago === key ? 'var(--orange-text)' : 'var(--ink-soft)', border: `1px solid ${metodoPago === key ? 'var(--orange-fill)' : 'var(--line)'}` }}>
                  {label}
                </button>
              ))}
            </div>
          )}
        </section>

        {/* ── PRODUCTOS ── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold tracking-wider" style={{ color: 'var(--orange-text)' }}>¿QUÉ PIDIERON?</p>
            <button onClick={escuchando ? detenerVoz : iniciarVoz}
              className="flex items-center gap-2 px-4 py-2 rounded-full font-bold text-sm"
              style={{ background: escuchando ? 'var(--orange-fill)' : 'var(--paper)', color: escuchando ? 'var(--on-orange)' : 'var(--ink)', border: `2px solid ${escuchando ? 'var(--orange)' : 'var(--line)'}` }}>
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
                  style={{ background: cant > 0 ? 'var(--paper-2)' : 'var(--paper)', border: `1px solid ${cant > 0 ? 'var(--orange-line)' : 'transparent'}` }}>
                  <div>
                    <p className="font-bold text-ink">{p.nombre}</p>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold" style={{ color: 'var(--ink-soft)' }}>
                        {formatMXN(precio)}
                      </p>
                      {canal === 'didi' && (
                        <p className="text-xs" style={{ color: 'var(--good-ink)' }}>neto {formatMXN(precioNeto)}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <button onClick={() => decrementar(p.id)} disabled={!cant}
                      className="w-11 h-11 rounded-full font-bold text-xl flex items-center justify-center"
                      style={{ background: cant ? 'var(--line)' : 'var(--paper)', color: cant ? 'var(--ink)' : 'var(--ink-mute)' }}>−</button>
                    <span className="text-ink font-bold text-lg w-6 text-center">{cant}</span>
                    <button onClick={() => incrementar(p.id)}
                      className="w-11 h-11 rounded-full font-bold text-xl flex items-center justify-center"
                      style={{ background: 'var(--orange-fill)', color: 'var(--on-orange)' }}>+</button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── CLIENTE ── */}
        <section>
          <p className="text-xs font-bold tracking-wider mb-2" style={{ color: 'var(--ink-soft)' }}>CLIENTE (OPCIONAL)</p>
          <input type="text" value={cliente} onChange={(e) => setCliente(e.target.value)}
            placeholder="Nombre del cliente..."
            className="w-full px-4 py-3 rounded-xl text-ink outline-none"
            style={{ background: 'var(--paper)', border: '1px solid var(--line)', fontSize: 16 }} />
        </section>

        {/* ── NOTAS ── */}
        <section>
          <p className="text-xs font-bold tracking-wider mb-2" style={{ color: 'var(--ink-soft)' }}>NOTAS (OPCIONAL)</p>
          <input type="text" value={notas} onChange={(e) => setNotas(e.target.value)}
            placeholder="sin cebolla, extra salsa..."
            className="w-full px-4 py-3 rounded-xl text-ink outline-none"
            style={{ background: 'var(--paper)', border: '1px solid var(--line)', fontSize: 16 }} />
        </section>

        {/* ── FECHA DEL PEDIDO ── */}
        <section>
          <p className="text-xs font-bold tracking-wider mb-2" style={{ color: 'var(--ink-soft)' }}>FECHA DEL PEDIDO</p>
          <div className="flex gap-2">
            {[
              { key: 'hoy',  label: 'Hoy'  },
              { key: 'ayer', label: 'Ayer' },
              { key: 'otra', label: '📅 Otra' },
            ].map(({ key, label }) => (
              <button key={key} onClick={() => setFechaOpt(key)}
                className="flex-1 py-3 rounded-full font-bold text-sm"
                style={{
                  background: fechaOpt === key ? 'var(--orange-fill)' : 'var(--paper)',
                  color:      fechaOpt === key ? 'var(--on-orange)'    : 'var(--ink-soft)',
                  border:     `1px solid ${fechaOpt === key ? 'var(--orange-fill)' : 'var(--line)'}`,
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
              className="mt-2 w-full px-4 py-3 rounded-xl text-ink outline-none"
              style={{ background: 'var(--paper)', border: '1px solid var(--orange)', fontSize: 16 }}
            />
          )}
        </section>

      </main>

      {/* ── Footer fijo: total + botón guardar ── */}
      <div className="fixed bottom-0 left-0 right-0 px-4 pt-3"
        style={{ background: 'var(--cream)', borderTop: '1px solid var(--paper-2)', paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <span style={{ color: 'var(--ink-soft)', fontSize: 12 }}>TOTAL {canal === 'didi' ? '(neto)' : ''}</span>
            {canal === 'didi' && total !== totalNeto && (
              <p className="text-xs" style={{ color: 'var(--ink-mute)' }}>Plataforma: {formatMXN(total)}</p>
            )}
          </div>
          <span className="text-2xl font-bold text-ink">{formatMXN(canal === 'didi' ? totalNeto : total)}</span>
        </div>
        <button onClick={guardar}
          disabled={itemsSeleccionados.length === 0 || guardando || (fechaOpt === 'otra' && !fechaPersonalizada)}
          className="btn-primary w-full py-3 rounded-full text-xl"
          style={{ minHeight: 56 }}>
          {guardando ? 'Guardando...' : 'REGISTRAR PEDIDO'}
        </button>
      </div>
    </div>
  );
}
