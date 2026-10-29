'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Label, Chips, MontoInput, TextInput, BotonPrincipal, Cargando, C } from '@/components/ui';
import { supabase } from '@/lib/supabase/client';
import { formatMXN } from '@/lib/calculos';
import { NEGOCIO_ID, DIAS_SEMANA_ISO, vibrar, msgError } from '@/lib/negocio';

const PCT = (v) => String(Math.round(Number(v) * 10000) / 100);   // 0.02 → "2"

export default function ConfiguracionPage() {
  const router = useRouter();
  const [cuentas,   setCuentas]   = useState([]);
  const [saldos,    setSaldos]    = useState({});   // cuenta_id → texto capturado
  const [config,    setConfig]    = useState(null);
  const [cargando,  setCargando]  = useState(true);
  const [guardando, setGuardando] = useState(null); // 'saldos' | 'config'
  const [aviso,     setAviso]     = useState(null);

  const cargar = useCallback(async () => {
    const [{ data: cs }, { data: cfg }] = await Promise.all([
      supabase.from('v_saldos_cuentas').select('*').eq('negocio_id', NEGOCIO_ID).eq('activa', true).order('orden'),
      supabase.from('configuracion_negocio').select('*').eq('negocio_id', NEGOCIO_ID).maybeSingle(),
    ]);
    setCuentas(cs || []);
    setSaldos({});
    if (cfg) setConfig({
      tasa_reserva_impuestos:     PCT(cfg.tasa_reserva_impuestos),
      meta_food_cost:             PCT(cfg.meta_food_cost),
      dias_reposicion_inventario: String(cfg.dias_reposicion_inventario),
      sueldo_dueno_semanal:       String(Number(cfg.sueldo_dueno_semanal) || ''),
      dia_pago_didi:              cfg.dia_pago_didi,
    });
    setCargando(false);
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const guardarSaldos = async () => {
    const cambios = Object.entries(saldos).filter(([, v]) => v !== '' && !isNaN(parseFloat(v)));
    if (cambios.length === 0) return;
    setGuardando('saldos');
    try {
      for (const [cuenta_id, v] of cambios) {
        const { error } = await supabase.rpc('fijar_saldo_inicial', { p_cuenta: cuenta_id, p_monto: parseFloat(v) });
        if (error) throw error;
      }
      vibrar();
      setAviso({ texto: 'Saldos guardados', color: C.ok });
      await cargar();
    } catch (err) {
      alert('No se pudo guardar: ' + msgError(err));
    }
    setGuardando(null);
  };

  const guardarConfig = async () => {
    setGuardando('config');
    const { error } = await supabase.from('configuracion_negocio').update({
      tasa_reserva_impuestos:     (parseFloat(config.tasa_reserva_impuestos) || 0) / 100,
      meta_food_cost:             (parseFloat(config.meta_food_cost) || 0) / 100,
      dias_reposicion_inventario: parseInt(config.dias_reposicion_inventario, 10) || 7,
      sueldo_dueno_semanal:       parseFloat(config.sueldo_dueno_semanal) || 0,
      dia_pago_didi:              config.dia_pago_didi,
    }).eq('negocio_id', NEGOCIO_ID);
    if (error) alert('No se pudo guardar: ' + msgError(error));
    else { vibrar(); setAviso({ texto: 'Configuración guardada', color: C.ok }); await cargar(); }
    setGuardando(null);
  };

  const set = (k) => (v) => setConfig((c) => ({ ...c, [k]: v }));
  const hayCambiosSaldos = Object.values(saldos).some((v) => v !== '');

  return (
    <div className="flex flex-col min-h-screen" style={{ background: C.bg }}>
      <header className="sticky top-0 z-40 flex items-center gap-3 px-4 py-3"
        style={{ background: C.bg, borderBottom: `1px solid ${C.surface2}` }}>
        <button type="button" onClick={() => router.back()} className="p-2 -ml-2 rounded-lg" aria-label="Regresar">
          <ArrowLeft size={22} />
        </button>
        <p className="font-bold text-lg">Configuración</p>
      </header>

      <main className="flex-1 px-4 pt-4 pb-16 space-y-6">
        {aviso && (
          <button type="button" onClick={() => setAviso(null)} className="w-full text-left px-4 py-3 rounded-xl text-sm font-bold"
            style={{ background: `${aviso.color}18`, color: aviso.color, border: `1px solid ${aviso.color}44` }}>
            {aviso.texto}
          </button>
        )}

        {cargando ? <Cargando /> : (
          <>
            <section className="space-y-3">
              <div>
                <Label color={C.brand}>SALDOS DE HOY</Label>
                <p className="text-xs" style={{ color: C.dimmer }}>
                  Escribe cuánto hay en cada cuenta ahorita. La app ajusta la diferencia y desde ahí lleva la cuenta.
                </p>
              </div>
              {cuentas.map((c) => (
                <div key={c.cuenta_id}>
                  <div className="flex justify-between mb-1">
                    <p className="text-sm font-bold text-white">{c.nombre}</p>
                    <p className="text-xs" style={{ color: C.dimmer }}>Actual: {formatMXN(c.saldo)}</p>
                  </div>
                  <MontoInput value={saldos[c.cuenta_id] ?? ''} placeholder={String(Number(c.saldo))}
                    onChange={(v) => setSaldos((s) => ({ ...s, [c.cuenta_id]: v }))} />
                </div>
              ))}
              <BotonPrincipal onClick={guardarSaldos} disabled={!hayCambiosSaldos || guardando === 'saldos'}>
                {guardando === 'saldos' ? 'Guardando...' : 'GUARDAR SALDOS'}
              </BotonPrincipal>
            </section>

            {config && (
              <section className="space-y-4">
                <Label color={C.brand}>PARÁMETROS</Label>
                <div>
                  <Label>TU SUELDO SEMANAL (cuenta como gasto)</Label>
                  <MontoInput value={config.sueldo_dueno_semanal} onChange={set('sueldo_dueno_semanal')} />
                  <p className="text-xs mt-1" style={{ color: C.dimmer }}>
                    Se agenda cada lunes en Gastos. Lo que retires además de esto es reparto de utilidad, no gasto.
                  </p>
                </div>
                <div>
                  <Label>RESERVA PARA IMPUESTOS (% DE LA VENTA)</Label>
                  <TextInput type="number" inputMode="decimal" value={config.tasa_reserva_impuestos} onChange={set('tasa_reserva_impuestos')} />
                </div>
                <div>
                  <Label>META FOOD COST (%)</Label>
                  <TextInput type="number" inputMode="decimal" value={config.meta_food_cost} onChange={set('meta_food_cost')} />
                </div>
                <div>
                  <Label>DÍAS DE INVENTARIO A REPONER</Label>
                  <TextInput type="number" inputMode="numeric" value={config.dias_reposicion_inventario} onChange={set('dias_reposicion_inventario')} />
                </div>
                <div>
                  <Label>DÍA QUE DEPOSITA DIDI</Label>
                  <Chips options={DIAS_SEMANA_ISO} value={config.dia_pago_didi} onChange={set('dia_pago_didi')} />
                </div>
                <BotonPrincipal onClick={guardarConfig} disabled={guardando === 'config'}>
                  {guardando === 'config' ? 'Guardando...' : 'GUARDAR PARÁMETROS'}
                </BotonPrincipal>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
