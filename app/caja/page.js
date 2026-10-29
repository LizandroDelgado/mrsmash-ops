'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, Bike, Calculator } from 'lucide-react';
import BottomNav from '@/components/BottomNav';
import MasMenu from '@/components/MasMenu';
import { Header, Label, Chips, MontoInput, TextInput, BotonPrincipal, Sheet, Vacio, Cargando, CuentaChips, C } from '@/components/ui';
import { supabase } from '@/lib/supabase/client';
import { formatMXN } from '@/lib/calculos';
import { NEGOCIO_ID, TIPOS_MOVIMIENTO, vibrar, msgError } from '@/lib/negocio';
import { diaOperativo, formatDiaCorto, formatFechaHora } from '@/lib/dia';

const LIQUIDAS = ['caja', 'banco', 'terminal'];

export default function CajaPage() {
  const router = useRouter();
  const [cuentas,     setCuentas]     = useState([]);
  const [movs,        setMovs]        = useState([]);
  const [filtro,      setFiltro]      = useState('todas');
  const [cargando,    setCargando]    = useState(true);
  const [accion,      setAccion]      = useState(null);   // retiro | aporte | transferir | didi | corte
  const [monto,       setMonto]       = useState('');
  const [nota,        setNota]        = useState('');
  const [cuentaSel,   setCuentaSel]   = useState(null);
  const [destinoSel,  setDestinoSel]  = useState(null);
  const [guardando,   setGuardando]   = useState(false);
  const [aviso,       setAviso]       = useState(null);   // { texto, color }
  const [corteHoy,    setCorteHoy]    = useState(null);
  const [esperadoCorte, setEsperadoCorte] = useState(null);

  const hoy = diaOperativo();
  const porClave = (clave) => cuentas.find((c) => c.clave === clave);

  const cargar = useCallback(async () => {
    const [{ data: cs, error: e1 }, { data: ms }] = await Promise.all([
      supabase.from('v_saldos_cuentas').select('*').eq('negocio_id', NEGOCIO_ID).eq('activa', true).order('orden'),
      supabase.from('movimientos').select('*').eq('negocio_id', NEGOCIO_ID)
        .order('created_at', { ascending: false }).limit(100),
    ]);
    if (e1) setAviso({ texto: 'Error al cargar cuentas: ' + e1.message, color: C.bad });
    setCuentas(cs || []);
    setMovs(ms || []);
    setCargando(false);
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const abrir = async (tipo) => {
    setMonto(''); setNota(''); setAviso(null);
    const caja = porClave('caja'), banco = porClave('banco'), didi = porClave('didi');
    if (tipo === 'retiro' || tipo === 'aporte') setCuentaSel(caja?.cuenta_id);
    if (tipo === 'transferir') { setCuentaSel(caja?.cuenta_id); setDestinoSel(banco?.cuenta_id); }
    if (tipo === 'didi') {
      setDestinoSel(banco?.cuenta_id);
      if (didi && Number(didi.saldo) > 0) setMonto(String(Number(didi.saldo)));
    }
    if (tipo === 'corte') {
      setCuentaSel(caja?.cuenta_id);
      setCorteHoy(null); setEsperadoCorte(null);
      if (caja) {
        const [{ data: corte }, { data: esp }] = await Promise.all([
          supabase.from('cortes_caja').select('*').eq('cuenta_id', caja.cuenta_id).eq('dia_operativo', hoy).maybeSingle(),
          supabase.rpc('saldo_cuenta', { p_cuenta: caja.cuenta_id, p_hasta_dia: hoy }),
        ]);
        setCorteHoy(corte || null);
        setEsperadoCorte(Number(esp ?? 0));
      }
    }
    setAccion(tipo);
  };

  const cerrar = () => { setAccion(null); setGuardando(false); };

  const terminar = (texto, color = C.ok) => {
    vibrar();
    setAviso({ texto, color });
    cerrar();
    cargar();
  };

  const guardar = async () => {
    const m = parseFloat(monto);
    if (!(m > 0)) return;
    setGuardando(true);
    try {
      if (accion === 'retiro' || accion === 'aporte') {
        const { error } = await supabase.from('movimientos').insert({
          negocio_id:  NEGOCIO_ID,
          cuenta_id:   cuentaSel,
          monto:       accion === 'retiro' ? -m : m,
          tipo:        accion === 'retiro' ? 'retiro_dueno' : 'aportacion_dueno',
          descripcion: nota.trim() || (accion === 'retiro' ? 'Retiro del dueño' : 'Aportación del dueño'),
        });
        if (error) throw error;
        terminar(accion === 'retiro' ? `Retiro de ${formatMXN(m)} registrado` : `Entraron ${formatMXN(m)}`);
      } else if (accion === 'transferir') {
        const { error } = await supabase.rpc('transferir', {
          p_origen: cuentaSel, p_destino: destinoSel, p_monto: m, p_descripcion: nota.trim() || null,
        });
        if (error) throw error;
        terminar(`Pasaste ${formatMXN(m)}`);
      } else if (accion === 'didi') {
        const { data, error } = await supabase.rpc('cobrar_didi', {
          p_negocio: NEGOCIO_ID, p_monto: m, p_destino: destinoSel,
        });
        if (error) throw error;
        const dif = Number(data?.diferencia || 0);
        if (dif === 0) terminar(`Cobro Didi de ${formatMXN(m)} registrado. Cuadra exacto.`);
        else terminar(
          `Didi depositó ${formatMXN(m)}, esperabas ${formatMXN(data.esperado)}. ` +
          `Diferencia: ${dif > 0 ? '+' : ''}${formatMXN(dif)} (ajustada).`,
          dif < 0 ? C.bad : C.warn,
        );
      }
    } catch (err) {
      setGuardando(false);
      alert('No se pudo guardar: ' + msgError(err));
    }
  };

  // El corte acepta contado = 0 (caja vacía); el resto exige monto > 0
  const montoOk = accion === 'corte' ? monto !== '' && parseFloat(monto) >= 0 : parseFloat(monto) > 0;

  const guardarCorte = async () => {
    if (!montoOk) return;
    setGuardando(true);
    const m = parseFloat(monto);
    const { data, error } = await supabase.rpc('corte_caja', {
      p_cuenta: cuentaSel, p_contado: m, p_dia: hoy, p_notas: nota.trim() || null,
    });
    if (error) { setGuardando(false); alert('No se pudo guardar: ' + msgError(error)); return; }
    const dif = Number(data?.diferencia || 0);
    terminar(
      dif === 0 ? 'Corte cuadrado ✓'
        : dif < 0 ? `Faltan ${formatMXN(-dif)} en caja (registrado)`
        : `Sobran ${formatMXN(dif)} en caja (registrado)`,
      dif === 0 ? C.ok : dif < 0 ? C.bad : C.warn,
    );
  };

  const liquido = cuentas.filter((c) => LIQUIDAS.includes(c.clave)).reduce((s, c) => s + Number(c.saldo), 0);
  const sinDatos = !cargando && cuentas.every((c) => Number(c.num_movimientos) === 0);
  const movsFiltrados = filtro === 'todas' ? movs : movs.filter((m) => m.cuenta_id === filtro);
  const nombreCuenta = (id) => cuentas.find((c) => c.cuenta_id === id)?.nombre || '';
  const didi = porClave('didi');
  const contado = parseFloat(monto);
  const difPreview = accion === 'corte' && esperadoCorte !== null && monto !== '' ? contado - esperadoCorte : null;

  const ACCIONES = [
    { key: 'retiro',     label: 'Retiro mío',          icon: ArrowUpRight },
    { key: 'aporte',     label: 'Meter dinero',        icon: ArrowDownLeft },
    { key: 'transferir', label: 'Pasar entre cuentas', icon: ArrowLeftRight },
    { key: 'didi',       label: 'Cobró Didi',          icon: Bike },
  ];

  const titulos = {
    retiro: 'Retiro mío', aporte: 'Meter dinero', transferir: 'Pasar entre cuentas',
    didi: 'Cobró Didi', corte: `Corte de caja · ${formatDiaCorto(hoy)}`,
  };

  return (
    <div className="flex flex-col min-h-screen" style={{ background: C.bg }}>
      <Header right={<MasMenu />} />

      <main className="flex-1 px-4 pt-4 pb-32 space-y-4">
        {aviso && (
          <button type="button" onClick={() => setAviso(null)} className="w-full text-left px-4 py-3 rounded-xl text-sm font-bold"
            style={{ background: `${aviso.color}18`, color: aviso.color, border: `1px solid ${aviso.color}44` }}>
            {aviso.texto}
          </button>
        )}

        {/* ── Dinero libre (Fase 3) ── */}
        <div className="rounded-2xl p-4" style={{ background: C.surface, border: `1px solid ${C.brand}44` }}>
          <p className="text-xs font-bold tracking-wider" style={{ color: C.brand }}>DINERO LIBRE</p>
          <p className="text-3xl font-bold text-white mt-1">—</p>
          <p className="text-xs mt-1" style={{ color: C.dimmer }}>
            Próximamente: lo que te queda después de pagos, reserva de impuestos e inventario.
          </p>
          <p className="text-sm mt-3" style={{ color: C.dim }}>
            En cuentas hoy: <span className="font-bold text-white">{formatMXN(liquido)}</span>
          </p>
        </div>

        {cargando ? <Cargando /> : sinDatos ? (
          <Vacio emoji="💵" titulo="Aún no hay saldos"
            texto="Cuenta el efectivo y revisa tu banco para empezar con números reales."
            accion="Captura tus saldos de hoy" onAccion={() => router.push('/configuracion')} />
        ) : null}

        {/* ── Saldos por cuenta (tocar = filtrar movimientos) ── */}
        {!cargando && (
          <div className="grid grid-cols-2 gap-2">
            {cuentas.map((c) => {
              const activo = filtro === c.cuenta_id;
              const neg = Number(c.saldo) < 0;
              return (
                <button key={c.cuenta_id} type="button" onClick={() => setFiltro(activo ? 'todas' : c.cuenta_id)}
                  className="rounded-2xl p-3 text-left"
                  style={{ background: C.surface, border: `1px solid ${activo ? C.brand : 'transparent'}`, minHeight: 72 }}>
                  <p className="text-xs truncate" style={{ color: C.dim }}>{c.nombre}</p>
                  <p className="text-lg font-bold" style={{ color: neg ? C.bad : '#fff' }}>{formatMXN(c.saldo)}</p>
                </button>
              );
            })}
          </div>
        )}

        {/* ── Acciones ── */}
        <div className="grid grid-cols-2 gap-2">
          {ACCIONES.map(({ key, label, icon: Icon }) => (
            <button key={key} type="button" onClick={() => abrir(key)}
              className="flex items-center gap-2 px-3 rounded-2xl font-bold text-sm text-white"
              style={{ background: C.surface2, minHeight: 56 }}>
              <Icon size={18} style={{ color: C.brand, flexShrink: 0 }} />{label}
            </button>
          ))}
        </div>
        <BotonPrincipal onClick={() => abrir('corte')}>
          <span className="inline-flex items-center gap-2"><Calculator size={20} /> CORTE DE CAJA</span>
        </BotonPrincipal>

        {/* ── Movimientos ── */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="mb-0">MOVIMIENTOS {filtro !== 'todas' && `· ${nombreCuenta(filtro).toUpperCase()}`}</Label>
            {filtro !== 'todas' && (
              <button type="button" onClick={() => setFiltro('todas')} className="text-xs font-bold px-3 rounded-lg"
                style={{ color: C.brand, background: C.surface2 }}>Ver todas</button>
            )}
          </div>
          {movsFiltrados.length === 0 ? (
            <p className="text-sm text-center py-6" style={{ color: '#444' }}>Sin movimientos</p>
          ) : (
            <div className="space-y-2">
              {movsFiltrados.map((m) => {
                const pos = Number(m.monto) >= 0;
                return (
                  <div key={m.id} className="flex items-center justify-between px-4 py-3 rounded-xl" style={{ background: C.surface }}>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-white font-medium truncate">{m.descripcion || TIPOS_MOVIMIENTO[m.tipo]}</p>
                      <p className="text-xs truncate" style={{ color: C.dimmer }}>
                        {TIPOS_MOVIMIENTO[m.tipo]} · {nombreCuenta(m.cuenta_id)} · {formatFechaHora(m.fecha)}
                      </p>
                    </div>
                    <span className="font-bold ml-3 whitespace-nowrap" style={{ color: pos ? C.ok : C.bad }}>
                      {pos ? '+' : '−'}{formatMXN(Math.abs(m.monto))}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* ── Hoja de acción ── */}
      <Sheet open={!!accion} title={titulos[accion]} onClose={cerrar}>
        {accion === 'corte' && corteHoy ? (
          <div className="rounded-2xl p-4 space-y-1" style={{ background: C.surface }}>
            <p className="text-sm" style={{ color: C.dim }}>Ya hiciste el corte de hoy.</p>
            <p className="text-white">Esperado: <b>{formatMXN(corteHoy.saldo_esperado)}</b></p>
            <p className="text-white">Contado: <b>{formatMXN(corteHoy.saldo_contado)}</b></p>
            <p className="font-bold text-lg" style={{ color: Number(corteHoy.diferencia) === 0 ? C.ok : Number(corteHoy.diferencia) < 0 ? C.bad : C.warn }}>
              Diferencia: {formatMXN(corteHoy.diferencia)}
            </p>
          </div>
        ) : (
          <>
            {accion === 'corte' && (
              <div className="rounded-2xl p-4" style={{ background: C.surface }}>
                <p className="text-xs" style={{ color: C.dim }}>Efectivo que debería haber en caja</p>
                <p className="text-2xl font-bold text-white">{esperadoCorte === null ? '…' : formatMXN(esperadoCorte)}</p>
              </div>
            )}
            {accion === 'didi' && (
              <div className="rounded-2xl p-4" style={{ background: C.surface }}>
                <p className="text-xs" style={{ color: C.dim }}>Didi te debe según tus ventas</p>
                <p className="text-2xl font-bold text-white">{formatMXN(didi?.saldo || 0)}</p>
              </div>
            )}

            <div>
              <Label color={C.brand}>
                {accion === 'corte' ? '¿CUÁNTO CONTASTE?' : accion === 'didi' ? '¿CUÁNTO DEPOSITÓ DIDI?' : '¿CUÁNTO?'}
              </Label>
              <MontoInput value={monto} onChange={setMonto} autoFocus />
              {difPreview !== null && (
                <p className="text-lg font-bold mt-2" style={{ color: difPreview === 0 ? C.ok : difPreview < 0 ? C.bad : C.warn }}>
                  {difPreview === 0 ? 'Cuadra ✓' : difPreview < 0 ? `Faltan ${formatMXN(-difPreview)}` : `Sobran ${formatMXN(difPreview)}`}
                </p>
              )}
            </div>

            {(accion === 'retiro' || accion === 'aporte') && (
              <div>
                <Label>{accion === 'retiro' ? 'DE QUÉ CUENTA' : 'A QUÉ CUENTA'}</Label>
                <CuentaChips cuentas={cuentas} value={cuentaSel} onChange={setCuentaSel} excluir={['didi']} />
              </div>
            )}
            {accion === 'transferir' && (
              <>
                <div>
                  <Label>DE</Label>
                  <CuentaChips cuentas={cuentas} value={cuentaSel} onChange={setCuentaSel} />
                </div>
                <div>
                  <Label>A</Label>
                  <CuentaChips cuentas={cuentas.filter((c) => c.cuenta_id !== cuentaSel)} value={destinoSel} onChange={setDestinoSel} />
                </div>
              </>
            )}
            {accion === 'didi' && (
              <div>
                <Label>¿A DÓNDE LLEGÓ?</Label>
                <CuentaChips cuentas={cuentas} value={destinoSel} onChange={setDestinoSel} excluir={['didi', 'caja']} />
              </div>
            )}
            {accion !== 'didi' && (
              <TextInput value={nota} onChange={setNota} placeholder="Nota (opcional)" />
            )}

            <BotonPrincipal disabled={!montoOk || guardando || (accion === 'transferir' && (!destinoSel || destinoSel === cuentaSel))}
              onClick={accion === 'corte' ? guardarCorte : guardar}>
              {guardando ? 'Guardando...' : 'GUARDAR'}
            </BotonPrincipal>
          </>
        )}
      </Sheet>

      <BottomNav />
    </div>
  );
}
