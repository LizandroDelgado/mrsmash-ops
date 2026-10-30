'use client';
// Único lugar de análisis. Todo viene agregado de Postgres (RPC dashboard, dinero_comprometido,
// cashflow_proyectado): el cliente no recibe filas crudas. Días por día operativo (corte 05:00).
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TrendingUp, TrendingDown, Minus, Info, ChevronRight, AlertTriangle, Lightbulb, CircleAlert } from 'lucide-react';
import {
  BarChart, Bar, ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend, Cell,
} from 'recharts';
import BottomNav from '@/components/BottomNav';
import MasMenu from '@/components/MasMenu';
import { Header, Chips, Sheet, Cargando, C } from '@/components/ui';
import { supabase } from '@/lib/supabase/client';
import { formatMXN } from '@/lib/calculos';
import { diaOperativo, sumarDias, diasEntre, formatDiaCorto } from '@/lib/dia';
import { NEGOCIO_ID, CATEGORIAS_GASTO } from '@/lib/negocio';
import { generarInsights } from '@/lib/insights';
import { useTokens } from '@/lib/useTokens';
import { CANAL_LABEL } from '@/lib/canales';

// Canales: paleta validada (dataviz) sobre la superficie var(--paper), orden fijo
// Canales: color fijo de marca en todas las gráficas (tokens --ch-*)
const CANALES = [
  { key: 'whatsapp', label: CANAL_LABEL.whatsapp, tok: 'chWhatsapp' },
  { key: 'didi',     label: CANAL_LABEL.didi,     tok: 'chDidi' },
  { key: 'salon',    label: CANAL_LABEL.salon,    tok: 'chSalon' },
];
// Semáforo sobre la banda oscura: punto + texto, nunca sólo color
const SEMAFORO = { verde: C.bandGood, amarillo: C.bandWarn, rojo: C.bandBad };
const CAT_LABEL = { ...Object.fromEntries(CATEGORIAS_GASTO.map((c) => [c.key, c.label])), sueldo_dueno: 'Tu sueldo', impuesto: 'Impuestos' };
const DIAS = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const HORAS = [16, 17, 18, 19, 20, 21, 22, 23, 0, 1];
const TT = {
  contentStyle: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, fontSize: 12, fontVariantNumeric: 'tabular-nums' },
  labelStyle: { color: C.ink, fontWeight: 700 }, itemStyle: { color: C.ink },
};

const n = (x) => Number(x) || 0;
const pct = (x, d = 1) => (x == null ? '—' : `${(n(x) * 100).toFixed(d)}%`);
const corto = (x) => (Math.abs(x) >= 1000 ? `$${(x / 1000).toFixed(Math.abs(x) >= 10000 ? 0 : 1)}k` : `$${Math.round(x)}`);

function rango(periodo, desdeOtro, hastaOtro) {
  const hoy = diaOperativo();
  if (periodo === 'hoy') return { desde: hoy, hasta: hoy };
  if (periodo === 'semana') {
    const dow = new Date(hoy + 'T12:00:00Z').getUTCDay();
    return { desde: sumarDias(hoy, dow === 0 ? -6 : 1 - dow), hasta: hoy };
  }
  if (periodo === 'mes') return { desde: hoy.slice(0, 8) + '01', hasta: hoy };
  return { desde: desdeOtro || hoy, hasta: hastaOtro || hoy };
}

// ── Piezas ──
function Delta({ actual, anterior, menosEsMejor = false }) {
  if (actual == null || anterior == null || n(anterior) === 0) return <span className="text-xs" style={{ color: C.dimmer }}>sin comparación</span>;
  const v = (n(actual) - n(anterior)) / Math.abs(n(anterior));
  const plano = Math.abs(v) < 0.005;
  const bueno = menosEsMejor ? v < 0 : v > 0;
  const Icon = plano ? Minus : v > 0 ? TrendingUp : TrendingDown;
  const color = plano ? C.dim : bueno ? C.ok : C.bad;
  return (
    <span className="flex items-center gap-1 text-xs font-bold" style={{ color }}>
      <Icon size={12} strokeWidth={2.5} />{Math.abs(v * 100).toFixed(0)}% <span className="font-normal" style={{ color: C.dimmer }}>vs antes</span>
    </span>
  );
}

function InfoBtn({ texto }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <button type="button" onClick={(e) => { e.stopPropagation(); setAbierto((x) => !x); }} aria-label="¿Qué es esto?"
        className="flex items-center justify-center shrink-0" style={{ width: 44, height: 44, margin: -12 }}>
        <Info size={14} style={{ color: abierto ? C.brandText : C.dimmer }} />
      </button>
      {abierto && <p className="text-xs mt-1 w-full" style={{ color: C.dim }}>{texto}</p>}
    </>
  );
}

function Tarjeta({ titulo, info, children, className = '' }) {
  return (
    <div className={`rounded-2xl p-3 ${className}`} style={{ background: C.surface, border: `1px solid ${C.border}` }}>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <p className="text-xs font-bold" style={{ color: C.dim }}>{titulo}</p>
        {info && <InfoBtn texto={info} />}
      </div>
      {children}
    </div>
  );
}

function Falta({ texto, href, accion }) {
  return (
    <Link href={href} className="flex items-center justify-between gap-2 mt-1 text-sm font-bold" style={{ color: C.warn, minHeight: 44 }}>
      <span>Falta capturar {texto}</span><span className="flex items-center shrink-0" style={{ color: C.brandText }}>{accion}<ChevronRight size={16} /></span>
    </Link>
  );
}

function Seccion({ titulo, children }) {
  return (
    <section className="space-y-2">
      <p className="text-xs font-bold tracking-wider px-1" style={{ color: C.dim }}>{titulo}</p>
      {children}
    </section>
  );
}

export default function DashboardPage() {
  const [periodo,   setPeriodo]   = useState('mes');
  const [desdeOtro, setDesdeOtro] = useState('');
  const [hastaOtro, setHastaOtro] = useState('');
  const [dash,      setDash]      = useState(null);
  const [comp,      setComp]      = useState(null);
  const [cf,        setCf]        = useState({ normal: [], pesimista: [] });
  const [escenario, setEscenario] = useState('normal');
  const [cargando,  setCargando]  = useState(true);
  const [error,     setError]     = useState(null);
  const [verComp,   setVerComp]   = useState(false);
  const [celda,     setCelda]     = useState(null);
  const [ms,        setMs]        = useState(null);
  const [extras,    setExtras]    = useState({ alertasCostos: [], cfg: null });
  const tk = useTokens();

  const { desde, hasta } = rango(periodo, desdeOtro, hastaOtro);

  const cargar = useCallback(async () => {
    if (desde > hasta) return;
    setCargando(true);
    setError(null);
    const t0 = performance.now();
    // Las obligaciones del periodo deben existir para devengar OPEX (idempotente)
    const finMes = sumarDias(hasta.slice(0, 8) + '01', 40).slice(0, 8) + '01';
    await supabase.rpc('generar_obligaciones', { p_negocio: NEGOCIO_ID, p_hasta: sumarDias(finMes, -1) });
    const [d, c, f1, f2, al, cf] = await Promise.all([
      supabase.rpc('dashboard', { p_negocio: NEGOCIO_ID, p_desde: desde, p_hasta: hasta }),
      supabase.rpc('dinero_comprometido', { p_negocio: NEGOCIO_ID, p_horizonte_dias: 30 }),
      supabase.rpc('cashflow_proyectado', { p_negocio: NEGOCIO_ID, p_semanas: 8, p_factor_ventas: 1 }),
      supabase.rpc('cashflow_proyectado', { p_negocio: NEGOCIO_ID, p_semanas: 8, p_factor_ventas: 0.8 }),
      supabase.rpc('alertas_costos', { p_negocio: NEGOCIO_ID }),
      supabase.from('configuracion_negocio').select('meta_food_cost, meta_margen_minimo_pct, pct_comision_didi, pct_promos_didi').eq('negocio_id', NEGOCIO_ID).single(),
    ]);
    setExtras({ alertasCostos: al.data || [], cfg: cf.data });
    const err = d.error || c.error || f1.error || f2.error;
    if (err) setError(err.message);
    setDash(d.data);
    setComp(c.data);
    setCf({ normal: f1.data || [], pesimista: f2.data || [] });
    setMs(Math.round(performance.now() - t0));
    setCargando(false);
  }, [desde, hasta]);

  useEffect(() => { cargar(); }, [cargar]);

  const a = dash?.actual || {};
  const ant = dash?.anterior || {};
  const ef = dash?.efectivo || {};
  const inv = dash?.inventario || {};
  const insights = generarInsights(dash, comp, extras);
  const sinVentas = !cargando && n(a.tickets) === 0;
  const hayGastos = !!ef.hay_gastos;
  const filasCf = cf[escenario];
  const primeraNeg = filasCf.find((w) => n(w.saldo_final) < 0)?.semana;

  return (
    <div className="flex flex-col min-h-screen" style={{ background: C.bg }}>
      <Header titulo="Dashboard" right={<MasMenu />} />
      <main className="flex-1 px-4 pt-4 pb-32 space-y-5">

        {/* ── Periodo ── */}
        <div className="space-y-2">
          <Chips options={[{ key: 'hoy', label: 'Hoy' }, { key: 'semana', label: 'Semana' }, { key: 'mes', label: 'Mes' }, { key: 'otro', label: 'Otro' }]}
            value={periodo} onChange={setPeriodo} />
          {periodo === 'otro' && (
            <div className="grid grid-cols-2 gap-2">
              {[[desdeOtro, setDesdeOtro, 'Desde'], [hastaOtro, setHastaOtro, 'Hasta']].map(([v, set, l]) => (
                <input key={l} type="date" value={v} aria-label={l} onChange={(e) => set(e.target.value)}
                  className="w-full px-3 rounded-xl text-ink outline-none"
                  style={{ background: C.surface, border: `1px solid ${C.border}`, minHeight: 48, fontSize: 16 }} />
              ))}
            </div>
          )}
          <p className="text-xs px-1" style={{ color: C.dimmer }}>
            {formatDiaCorto(desde)}{desde !== hasta && ` – ${formatDiaCorto(hasta)}`} · comparado con los {diasEntre(desde, hasta) + 1} días anteriores
          </p>
        </div>

        {(cargando && !dash) || !tk ? <Cargando /> : error ? (
          <p className="text-sm rounded-2xl p-4" style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.bad }}>⚠ {error}</p>
        ) : (
          <>
            {/* ── 1. Dinero libre ── */}
            {comp?.sin_saldos ? (
              <Link href="/configuracion" className="block rounded-card p-5" style={{ background: C.band, color: C.bandInk }}>
                <p className="text-xs font-bold tracking-wider" style={{ color: C.bandInkSoft }}>DINERO LIBRE</p>
                <p className="text-2xl font-display mt-1" style={{ color: C.bandInk, fontWeight: 700 }}>Primero captura tus saldos</p>
                <p className="text-sm mt-1" style={{ color: C.bandInkSoft }}>
                  Dinos cuánto hay hoy en caja, banco y terminal para saber cuánto es realmente tuyo.
                  Ya tienes {formatMXN(comp.comprometido)} apartados en pagos próximos.
                </p>
                <p className="flex items-center gap-1 text-base font-display mt-3" style={{ color: C.bandAccent, fontWeight: 600 }}>Capturar saldos <ChevronRight size={16} /></p>
              </Link>
            ) : comp && (
              <button type="button" onClick={() => setVerComp(true)} className="w-full text-left rounded-card p-5"
                style={{ background: C.band, color: C.bandInk }}>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold tracking-wider" style={{ color: C.bandInkSoft }}>DINERO LIBRE</p>
                  <span className="flex items-center gap-1 text-xs font-bold" style={{ color: SEMAFORO[comp.semaforo] }}>
                    <span className="inline-block rounded-full" style={{ width: 10, height: 10, background: SEMAFORO[comp.semaforo] }} />
                    {comp.semaforo === 'verde' ? 'Tranquilo' : comp.semaforo === 'amarillo' ? 'Justo' : 'No alcanza'}
                  </span>
                </div>
                <p className="font-display mt-1" style={{ fontSize: 44, lineHeight: 1.1, fontWeight: 700, color: n(comp.dinero_libre) < 0 ? C.bandBad : C.bandInk }}>{formatMXN(comp.dinero_libre)}</p>
                <p className="text-sm mt-2" style={{ color: C.bandInkSoft }}>
                  Tienes {formatMXN(comp.dinero_total)} · ya está apartado {formatMXN(comp.comprometido)} · Didi te debe {formatMXN(comp.por_cobrar_didi)}
                </p>
                <p className="flex items-center gap-1 text-sm font-display mt-3" style={{ color: C.bandAccent, fontWeight: 600 }}>Ver qué está apartado <ChevronRight size={14} /></p>
              </button>
            )}

            {/* ── 2. KPIs ── */}
            <div className="grid grid-cols-2 gap-2">
              <Tarjeta titulo="LO QUE ENTRÓ (NETO)" info="Lo que vendiste menos comisión y promos de Didi. Las retenciones de impuestos van aparte.">
                <p className="text-xl font-bold text-ink">{formatMXN(a.venta_neta)}</p>
                {sinVentas ? <Falta texto="ventas" href="/nuevo-pedido" accion="Pedido" /> : <Delta actual={a.venta_neta} anterior={ant.venta_neta} />}
              </Tarjeta>
              <Tarjeta titulo="LO QUE TE QUEDA DESPUÉS DE TODO" info="Venta neta menos costo de lo vendido y gastos fijos del periodo (sin préstamos ni retiros).">
                <p className="text-xl font-bold" style={{ color: n(a.utilidad_operativa) < 0 ? C.bad : C.ink }}>{formatMXN(a.utilidad_operativa)}</p>
                {!hayGastos ? <Falta texto="gastos fijos" href="/gastos" accion="Gastos" /> : <Delta actual={a.utilidad_operativa} anterior={ant.utilidad_operativa} />}
              </Tarjeta>
              <Tarjeta titulo="COSTO DE COMIDA" info={`De cada $100 que entran, cuánto se va en ingredientes y empaque. Tu meta: ${pct(a.meta_food_cost, 0)}.`}>
                <p className="text-xl font-bold" style={{ color: a.food_cost == null ? C.ink : n(a.food_cost) <= n(a.meta_food_cost) ? C.ok : C.bad }}>{pct(a.food_cost)}</p>
                <Delta actual={a.food_cost} anterior={ant.food_cost} menosEsMejor />
                {a.food_cost_real != null && <p className="text-xs" style={{ color: C.dim }}>Real por conteo: {pct(a.food_cost_real)}</p>}
              </Tarjeta>
              <Tarjeta titulo="TICKET PROMEDIO" info="Lo que deja en promedio cada pedido (neto).">
                <p className="text-xl font-bold text-ink">{a.ticket_promedio == null ? '—' : formatMXN(a.ticket_promedio)}</p>
                <Delta actual={a.ticket_promedio} anterior={ant.ticket_promedio} />
              </Tarjeta>
              <Tarjeta titulo="BURGERS VENDIDAS" info="Burgers de pedidos capturados con productos. Las importaciones de Didi no traen productos.">
                <p className="text-xl font-bold text-ink">{n(a.burgers)}</p>
                <Delta actual={a.burgers} anterior={ant.burgers} />
              </Tarjeta>
              <Tarjeta titulo="PUNTO DE EQUILIBRIO" info="Burgers que necesitas vender en el periodo para cubrir tus gastos fijos.">
                {!hayGastos ? <Falta texto="gastos fijos" href="/gastos" accion="Gastos" />
                  : a.equilibrio_burgers == null ? <p className="text-sm mt-1" style={{ color: C.dim }}>Sin ventas para calcularlo</p> : (
                    <>
                      <p className="text-xl font-bold text-ink">{n(a.burgers)} <span className="text-sm" style={{ color: C.dim }}>de {a.equilibrio_burgers}</span></p>
                      <div className="h-2 rounded-full mt-1 overflow-hidden" style={{ background: C.surface2 }}>
                        <div className="h-full rounded-full" style={{ width: `${Math.min(100, (n(a.burgers) / n(a.equilibrio_burgers)) * 100)}%`, background: n(a.burgers) >= n(a.equilibrio_burgers) ? C.ok : C.warn }} />
                      </div>
                      <p className="text-xs mt-1" style={{ color: C.dim }}>{formatMXN(a.equilibrio_pesos)} netos</p>
                    </>
                  )}
              </Tarjeta>
            </div>

            {/* ── 3. Insights ── */}
            <Seccion titulo="QUÉ CAMBIAR">
              {insights.length === 0 ? (
                <p className="text-sm rounded-2xl p-4" style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.dim }}>Nada urgente con los datos del periodo.</p>
              ) : insights.map((i) => {
                const color = i.nivel === 'rojo' ? C.bad : i.nivel === 'amarillo' ? C.warn : C.brand;
                const Icon = i.nivel === 'rojo' ? CircleAlert : i.nivel === 'amarillo' ? AlertTriangle : Lightbulb;
                const cuerpo = (
                  <>
                    <p className="flex items-start gap-2 font-bold text-ink text-sm"><Icon size={16} className="shrink-0 mt-0.5" style={{ color }} />{i.titulo}</p>
                    <p className="text-xs mt-1" style={{ color: C.dim }}>{i.texto}</p>
                    <p className="text-xs mt-1 font-bold" style={{ color }}>→ {i.accion}</p>
                    {i.impacto > 0 && <p className="text-xs mt-1" style={{ color: C.dimmer }}>Impacto estimado ≈ {formatMXN(i.impacto)}</p>}
                  </>
                );
                const st = { background: C.surface, borderLeft: `4px solid ${color}` };
                return i.href
                  ? <Link key={i.id} href={i.href} className="block rounded-2xl p-3" style={st}>{cuerpo}</Link>
                  : <div key={i.id} className="rounded-2xl p-3" style={st}>{cuerpo}</div>;
              })}
            </Seccion>

            {/* ── 4. Estado de resultados ── */}
            <Seccion titulo="CÓMO SE FUE TU DINERO">
              <div className="rounded-2xl p-3 text-sm" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
                {(() => {
                  const base = n(a.venta_neta);
                  const fila = (label, valor, { fuerte, neg, sangria, color } = {}) => (
                    <div key={label} className={`flex items-center justify-between gap-2 py-1.5 ${fuerte ? 'font-bold' : ''}`}
                      style={{ borderTop: fuerte ? `1px solid ${C.border}` : 'none', paddingLeft: sangria ? 12 : 0 }}>
                      <span style={{ color: fuerte ? C.ink : C.dim }}>{label}</span>
                      <span className="text-right shrink-0" style={{ color: color || (fuerte ? C.ink : 'var(--ink)') }}>
                        {(neg && n(valor)) || (!neg && n(valor) < 0) ? '−' : ''}{formatMXN(Math.abs(n(valor)))}
                        <span className="text-xs ml-2" style={{ color: C.dimmer }}>{base > 0 ? pct(Math.abs(n(valor)) / base, 0) : ''}</span>
                      </span>
                    </div>
                  );
                  const opex = Object.entries(a.opex || {}).sort((x, y) => y[1] - x[1]);
                  return (
                    <>
                      {fila('Vendiste', a.venta_bruta)}
                      {n(a.comision_didi) + n(a.promos_didi) > 0 && (
                        <>
                          {fila('Comisión Didi', a.comision_didi, { neg: true, sangria: true })}
                          {fila('Promos Didi', a.promos_didi, { neg: true, sangria: true })}
                        </>
                      )}
                      {fila('Lo que entró (neto)', a.venta_neta, { fuerte: true })}
                      {fila('Ingredientes y empaque', a.costo_ventas, { neg: true })}
                      {fila('Margen después de comida', a.margen_bruto, { fuerte: true })}
                      {opex.length ? opex.map(([k, v]) => fila(CAT_LABEL[k] || k, v, { neg: true, sangria: true }))
                        : <Falta texto="gastos fijos" href="/gastos" accion="Gastos" />}
                      {fila('Lo que te queda después de todo', a.utilidad_operativa, { fuerte: true, color: n(a.utilidad_operativa) < 0 ? C.bad : C.ok })}
                      {n(a.prestamos) > 0 && fila('Pago de préstamos', a.prestamos, { neg: true })}
                      {n(a.retenciones_didi) > 0 && fila('Impuestos retenidos por Didi', a.retenciones_didi, { neg: true })}
                      {n(a.retiros) > 0 && fila('Retiros tuyos', a.retiros, { neg: true })}
                      <div className="text-xs mt-2 space-y-1" style={{ color: C.dimmer }}>
                        {n(a.bruta_didi_estimada) > 0 && <p>Didi capturado: comisión, promos y retenciones estimadas con los % de Configuración.</p>}
                        {n(a.retenciones_didi) > 0 && <p>Impuestos retenidos por Didi: anticipo de ISR/IVA, no es costo del producto; no entra al banco con el depósito.</p>}
                        {n(a.costo_respaldo) > 0 && <p>{formatMXN(a.costo_respaldo)} del costo usa el costo registrado del producto (sin receta o venta anterior al inventario).</p>}
                        {n(a.costo_estimado_import) > 0 && <p>{formatMXN(a.costo_estimado_import)} estimado para ventas Didi importadas (no traen productos).</p>}
                        {a.prime_cost != null && <p>Comida + nómina + tu sueldo = {pct(a.prime_cost, 0)} de lo que entra. Reserva de impuestos del periodo: {formatMXN(a.reserva_impuestos)}.</p>}
                        {a.margen_seguridad != null && (n(a.margen_seguridad) >= 0
                          ? <p>Margen de seguridad: vendes {pct(a.margen_seguridad, 0)} arriba de tu punto de equilibrio.</p>
                          : <p>Estás {pct(-n(a.margen_seguridad), 0)} debajo de tu punto de equilibrio.</p>)}
                      </div>
                    </>
                  );
                })()}
              </div>
            </Seccion>

            {/* ── 5. Gráficas ── */}
            <Seccion titulo="VENTAS POR DÍA (NETO)">
              <div className="rounded-2xl p-2" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
                {(dash.diario || []).length === 0 ? <Falta texto="ventas" href="/nuevo-pedido" accion="Pedido" /> : (
                  <div style={{ height: 200 }}>
                    <ResponsiveContainer>
                      <BarChart data={dash.diario.map((d) => ({ ...d, label: d.dia.slice(8, 10) }))} margin={{ top: 8, right: 4, left: -16, bottom: 0 }}>
                        <CartesianGrid vertical={false} stroke={tk.line} />
                        <XAxis dataKey="label" tick={{ fill: tk.inkSoft, fontSize: 10 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: tk.inkSoft, fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={corto} />
                        <Tooltip {...TT} formatter={(v, k) => [formatMXN(v), CANALES.find((c) => c.key === k)?.label]} labelFormatter={(l, p) => p?.[0] ? formatDiaCorto(p[0].payload.dia) : l} cursor={{ fill: tk.line }} />
                        <Legend formatter={(k) => <span style={{ color: C.dim, fontSize: 12 }}>{CANALES.find((c) => c.key === k)?.label}</span>} iconSize={10} />
                        {CANALES.map((c, i) => <Bar key={c.key} dataKey={c.key} stackId="v" fill={tk[c.tok]} stroke={tk.paper} strokeWidth={2}
                          radius={i === CANALES.length - 1 ? [6, 6, 0, 0] : 0} isAnimationActive={!tk.reduceMotion} />)}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
                <div className="flex flex-wrap gap-x-3 gap-y-1 px-2 pb-1 text-xs" style={{ color: C.dim }}>
                  {CANALES.map((c) => {
                    const v = n(a.canales?.[c.key]?.neta);
                    return v > 0 && <span key={c.key}>{c.label} {pct(v / n(a.venta_neta), 0)}</span>;
                  })}
                </div>
              </div>
            </Seccion>

            <Seccion titulo="¿A QUÉ HORA TE PIDEN?">
              <div className="rounded-2xl p-3" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
                {(dash.heatmap || []).length === 0 ? (
                  <p className="text-sm" style={{ color: C.dim }}>Sin pedidos capturados al momento en el periodo. Captura en vivo para ver tus horas pico.</p>
                ) : (() => {
                  const mapa = {}; let max = 1;
                  dash.heatmap.forEach((h) => { mapa[`${h.dow}-${h.hora}`] = n(h.tickets); max = Math.max(max, n(h.tickets)); });
                  return (
                    <>
                      <div className="grid gap-0.5" style={{ gridTemplateColumns: `28px repeat(${HORAS.length}, 1fr)` }}>
                        <span />
                        {HORAS.map((h) => <span key={h} className="text-center" style={{ color: C.dimmer, fontSize: 9 }}>{h}</span>)}
                        {[2, 3, 4, 5, 6, 7, 1].map((d) => [
                          <span key={`l${d}`} className="text-xs" style={{ color: C.dimmer }}>{DIAS[d]}</span>,
                          ...HORAS.map((h) => {
                            const v = mapa[`${d}-${h}`] || 0;
                            return <button key={`${d}-${h}`} type="button" onClick={() => setCelda({ d, h, v })} aria-label={`${DIAS[d]} ${h}:00, ${v} pedidos`}
                              title={`${DIAS[d]} ${h}:00 · ${v} pedidos`}
                              className="rounded" style={{ height: 22, minHeight: 22, background: v ? `color-mix(in srgb, var(--orange) ${Math.round(18 + 82 * (v / max))}%, var(--heat-0))` : C.surface2 }} />;
                          }),
                        ])}
                      </div>
                      <p className="text-xs mt-2" style={{ color: C.dim }}>
                        {celda ? `${DIAS[celda.d]} ${celda.h}:00 → ${celda.v} pedidos` : 'Toca un cuadro para ver los pedidos.'} Basado en {dash.heatmap_cobertura?.con_hora} de {dash.heatmap_cobertura?.total} pedidos capturados en vivo.
                      </p>
                    </>
                  );
                })()}
              </div>
            </Seccion>

            <Seccion titulo="CUÁNTO TE DEJA CADA BURGER POR CANAL">
              <div className="rounded-2xl p-2" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
                {(() => {
                  const burgers = {};
                  (dash.margenes || []).filter((m) => m.burger).forEach((m) => {
                    (burgers[m.nombre] ||= { nombre: m.nombre.replace(' Smash', '').replace('Smash ', ''), receta: m.tiene_receta })[m.canal] = n(m.margen);
                  });
                  const datos = Object.values(burgers);
                  if (!datos.length) return <Falta texto="productos" href="/inventario/recetas" accion="Recetas" />;
                  return (
                    <>
                      <div style={{ height: 40 + datos.length * 52 }}>
                        <ResponsiveContainer>
                          <BarChart data={datos} layout="vertical" margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barGap={2}>
                            <CartesianGrid vertical={false} stroke={tk.line} />
                            <XAxis type="number" tick={{ fill: tk.inkSoft, fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={corto} />
                            <YAxis type="category" dataKey="nombre" width={88} tick={{ fill: tk.inkSoft, fontSize: 11 }} axisLine={false} tickLine={false} />
                            <Tooltip {...TT} formatter={(v, k) => [formatMXN(v), CANALES.find((c) => c.key === k)?.label]} cursor={{ fill: tk.line }} />
                            <Legend formatter={(k) => <span style={{ color: C.dim, fontSize: 12 }}>{CANALES.find((c) => c.key === k)?.label}</span>} iconSize={10} />
                            {CANALES.map((c) => <Bar key={c.key} dataKey={c.key} fill={tk[c.tok]} radius={[0, 6, 6, 0]} barSize={10} isAnimationActive={!tk.reduceMotion} />)}
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                      <p className="text-xs px-2 pb-1" style={{ color: C.dimmer }}>
                        Precio neto del canal menos costo de receta. Didi neto = precio Didi × (1 − {pct(n(dash.tasas_didi?.tasa_comision) + n(dash.tasas_didi?.tasa_promos), 1)} de comisión y promos).
                        <Link href="/configuracion/precios-costos" className="ml-1" style={{ color: C.brandText }}>Cambiar precios</Link>
                      </p>
                    </>
                  );
                })()}
              </div>
            </Seccion>

            <Seccion titulo="LO QUE MÁS VENDES">
              <div className="rounded-2xl p-3 space-y-2" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
                {(dash.productos || []).length === 0 ? <p className="text-sm" style={{ color: C.dim }}>Sin productos en el periodo.</p>
                  : (() => {
                    const total = dash.productos.reduce((s, p) => s + n(p.unidades), 0);
                    return dash.productos.slice(0, 8).map((p) => (
                      <div key={p.nombre}>
                        <div className="flex justify-between text-sm">
                          <span className="text-ink truncate">{p.nombre}</span>
                          <span className="shrink-0" style={{ color: C.dim }}>{n(p.unidades)} · {pct(n(p.unidades) / total, 0)}</span>
                        </div>
                        <div className="h-1.5 rounded-full mt-1" style={{ background: C.surface2 }}>
                          <div className="h-full rounded-full" style={{ width: `${(n(p.unidades) / n(dash.productos[0].unidades)) * 100}%`, background: C.brandFill }} />
                        </div>
                      </div>
                    ));
                  })()}
              </div>
            </Seccion>

            <Seccion titulo="COSTO DE COMIDA POR SEMANA">
              <div className="rounded-2xl p-2" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
                <div style={{ height: 170 }}>
                  <ResponsiveContainer>
                    <BarChart data={(dash.fc_semanal || []).map((s) => ({ ...s, label: s.semana.slice(5).replace('-', '/'), fc: s.fc == null ? null : n(s.fc) * 100 }))}
                      margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke={tk.line} />
                      <XAxis dataKey="label" tick={{ fill: tk.inkSoft, fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: tk.inkSoft, fontSize: 10 }} axisLine={false} tickLine={false} unit="%" />
                      <Tooltip {...TT} formatter={(v) => [`${n(v).toFixed(1)}%`, 'Costo de comida']} labelFormatter={(l) => `Semana del ${l}`} cursor={{ fill: tk.line }} />
                      <ReferenceLine y={n(a.meta_food_cost) * 100} stroke={tk.inkSoft} strokeDasharray="4 4"
                        label={{ value: `meta ${pct(a.meta_food_cost, 0)}`, fill: tk.inkSoft, fontSize: 10, position: 'insideTopRight' }} />
                      <Bar dataKey="fc" radius={[6, 6, 0, 0]} barSize={18} isAnimationActive={!tk.reduceMotion}>
                        {(dash.fc_semanal || []).map((s) => <Cell key={s.semana} fill={n(s.fc) > n(a.meta_food_cost) ? tk.bad : tk.good} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </Seccion>

            {/* ── 6. Cashflow ── */}
            <Seccion titulo="TU DINERO LAS PRÓXIMAS 8 SEMANAS">
              <div className="rounded-2xl p-2 space-y-2" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
                <Chips options={[{ key: 'normal', label: 'Normal' }, { key: 'pesimista', label: 'Ventas −20%' }]} value={escenario} onChange={setEscenario} />
                {comp?.sin_saldos && <p className="text-xs px-1" style={{ color: C.warn }}>Arranca en $0 porque no has capturado saldos.</p>}
                <div style={{ height: 200 }}>
                  <ResponsiveContainer>
                    <ComposedChart data={filasCf.map((w) => ({
                      label: `S${w.semana}`, entradas: n(w.entradas_directas) + n(w.entradas_didi),
                      salidas: -(n(w.compras) + n(w.obligaciones) + n(w.sueldo_dueno) + n(w.retiros)), saldo: n(w.saldo_final),
                    }))} margin={{ top: 8, right: 4, left: -12, bottom: 0 }} stackOffset="sign">
                      <CartesianGrid vertical={false} stroke={tk.line} />
                      <XAxis dataKey="label" tick={{ fill: tk.inkSoft, fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: tk.inkSoft, fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={corto} />
                      <Tooltip {...TT} formatter={(v, k) => [formatMXN(Math.abs(v)), { entradas: 'Entra', salidas: 'Sale', saldo: 'Saldo' }[k]]} cursor={{ fill: tk.line }} />
                      <Legend formatter={(k) => <span style={{ color: C.dim, fontSize: 12 }}>{{ entradas: 'Entra', salidas: 'Sale', saldo: 'Saldo al cierre' }[k]}</span>} iconSize={10} />
                      <ReferenceLine y={0} stroke={tk.inkSoft} />
                      <Bar dataKey="entradas" stackId="f" fill={tk.good} radius={[6, 6, 0, 0]} barSize={14} isAnimationActive={!tk.reduceMotion} />
                      <Bar dataKey="salidas" stackId="f" fill={tk.bad} radius={[6, 6, 0, 0]} barSize={14} isAnimationActive={!tk.reduceMotion} />
                      <Line dataKey="saldo" stroke={tk.ink} strokeWidth={2} isAnimationActive={false} dot={{ r: 4, fill: tk.ink, stroke: tk.paper, strokeWidth: 2 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs" style={{ color: C.dim }}>
                    <thead>
                      <tr className="text-left" style={{ color: C.dimmer }}>
                        <th className="py-1 font-normal">Semana</th><th className="font-normal text-right">Entra</th>
                        <th className="font-normal text-right">Sale</th><th className="font-normal text-right">Saldo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filasCf.map((w) => {
                        const neg = w.semana === primeraNeg;
                        return (
                          <tr key={w.semana} style={{ borderTop: `1px solid ${C.surface2}`, background: neg ? `${C.badSoft}` : 'transparent' }}>
                            <td className="py-1.5">{formatDiaCorto(String(w.desde).slice(0, 10))}</td>
                            <td className="text-right">{formatMXN(n(w.entradas_directas) + n(w.entradas_didi))}</td>
                            <td className="text-right">{formatMXN(n(w.compras) + n(w.obligaciones) + n(w.sueldo_dueno) + n(w.retiros))}</td>
                            <td className="text-right font-bold" style={{ color: n(w.saldo_final) < 0 ? C.bad : C.ink }}>{formatMXN(w.saldo_final)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {primeraNeg && <p className="text-xs px-1 font-bold" style={{ color: C.bad }}>⚠ En la semana {primeraNeg} te quedarías en negativo.</p>}
                <p className="text-xs px-1" style={{ color: C.dimmer }}>
                  Ventas: promedio por día de las 4 semanas al {filasCf[0] ? formatDiaCorto(String(filasCf[0].ventana_hasta).slice(0, 10)) : '—'} (lunes cerrado).
                  Didi paga el lunes de la semana siguiente. Salidas: compras promedio, pagos programados, tu sueldo y retiros.
                </p>
              </div>
            </Seccion>

            {/* ── 7. Inventario y efectivo ── */}
            <Seccion titulo="INVENTARIO Y EFECTIVO">
              <div className="grid grid-cols-2 gap-2">
                <Tarjeta titulo="INVENTARIO" info="Lo que vale lo que tienes en bodega, al costo promedio.">
                  {n(inv.contados) === 0 ? <Falta texto="tu primer conteo" href="/inventario/conteo" accion="Contar" /> : (
                    <>
                      <p className="text-xl font-bold text-ink">{formatMXN(inv.valor)}</p>
                      <p className="text-xs" style={{ color: C.dim }}>{inv.dias_inventario != null ? `≈ ${inv.dias_inventario} días de venta` : '—'}</p>
                    </>
                  )}
                </Tarjeta>
                <Tarjeta titulo="MERMA" info="Lo que se tiró o faltó en conteos, en pesos.">
                  <p className="text-xl font-bold" style={{ color: n(a.merma_pct) > 0.03 ? C.bad : C.ink }}>{formatMXN(a.merma)}</p>
                  <p className="text-xs" style={{ color: C.dim }}>{a.merma_pct != null ? `${pct(a.merma_pct)} de la venta` : '—'}</p>
                </Tarjeta>
                <Tarjeta titulo="TE ALCANZA PARA" info="Días que aguantas con tu efectivo pagando gastos fijos y compras, sin vender nada.">
                  {ef.sin_saldos ? <Falta texto="saldos" href="/configuracion" accion="Saldos" />
                    : <p className="text-xl font-bold text-ink">{ef.runway_dias == null ? '—' : `${ef.runway_dias} días`}</p>}
                  <p className="text-xs" style={{ color: C.dim }}>Gasto fijo {formatMXN(ef.gasto_fijo_diario)}/día</p>
                </Tarjeta>
                <Tarjeta titulo="DIFERENCIAS DE CAJA" info="Suma de faltantes y sobrantes de tus cortes en el periodo.">
                  <p className="text-xl font-bold" style={{ color: n(a.diferencias_corte) < 0 ? C.bad : C.ink }}>{formatMXN(a.diferencias_corte)}</p>
                  <p className="text-xs" style={{ color: C.dim }}>Retiros tuyos {formatMXN(a.retiros)}</p>
                </Tarjeta>
              </div>
              <div className="rounded-2xl p-3 text-sm space-y-1" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
                {(ef.cuentas || []).map((c) => (
                  <div key={c.clave} className="flex justify-between">
                    <span style={{ color: C.dim }}>{c.nombre}{c.clave === 'didi' && ' (no disponible aún)'}</span>
                    <span className="font-bold text-ink">{formatMXN(c.saldo)}</span>
                  </div>
                ))}
                {n(inv.productos_sin_receta) > 0 && (
                  <Link href="/inventario/recetas" className="flex justify-between pt-2 text-xs" style={{ color: C.warn, minHeight: 32 }}>
                    <span>{inv.productos_sin_receta} productos sin receta usan su costo registrado</span><ChevronRight size={14} />
                  </Link>
                )}
              </div>
              {ms != null && <p className="text-xs text-center" style={{ color: 'var(--ink-mute)' }}>Cargó en {(ms / 1000).toFixed(1)} s</p>}
            </Seccion>
          </>
        )}
      </main>

      {/* Desglose de lo comprometido */}
      <Sheet open={verComp && !!comp} title="Lo que ya está apartado" onClose={() => setVerComp(false)}>
        {comp && (
          <div className="space-y-1">
            {(comp.lineas || []).map((l, i) => (
              <div key={i} className="flex items-center justify-between gap-2 py-2" style={{ borderBottom: `1px solid ${C.surface2}` }}>
                <span className="min-w-0">
                  <span className="block text-sm text-ink truncate">{l.concepto}</span>
                  <span className="block text-xs" style={{ color: l.vencida ? C.bad : C.dimmer }}>
                    {l.vence ? `${l.vencida ? 'Venció' : 'Vence'} ${formatDiaCorto(l.vence)}` : l.tipo === 'reposicion' ? 'Para reponer insumos' : 'Apártalo cada mes'}
                  </span>
                </span>
                <span className="font-bold text-ink shrink-0">{formatMXN(l.monto)}</span>
              </div>
            ))}
            <div className="flex justify-between pt-2 font-bold">
              <span className="text-ink">Total apartado</span><span className="text-ink">{formatMXN(comp.comprometido)}</span>
            </div>
            <p className="text-xs pt-1" style={{ color: C.dimmer }}>Pagos de los próximos {comp.horizonte_dias} días (incluye vencidos), reposición de inventario e impuestos del mes.</p>
            <Link href="/gastos" className="flex items-center justify-center gap-1 rounded-full font-bold mt-2"
              style={{ background: C.surface2, color: C.brandText, minHeight: 48 }}>Ir a Por pagar <ChevronRight size={16} /></Link>
          </div>
        )}
      </Sheet>

      <BottomNav />
    </div>
  );
}
