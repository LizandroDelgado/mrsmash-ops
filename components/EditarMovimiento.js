'use client';
// Editar o eliminar un movimiento de Caja. Los manuales (retiro, meter dinero, transferencia, cobro
// Didi, saldo inicial) se corrigen aquí: el ledger revierte el original y publica el corregido.
// Ventas, compras, pagos y cortes se corrigen desde su origen, para que todo siga cuadrando.
import { useState } from 'react';
import Link from 'next/link';
import AccionesEdicion from '@/components/AccionesEdicion';
import { Sheet, Label, MontoInput, TextInput, CuentaChips, BotonPrincipal, C } from '@/components/ui';
import { supabase } from '@/lib/supabase/client';
import { formatMXN } from '@/lib/calculos';
import { TIPOS_MOVIMIENTO, vibrar, msgError } from '@/lib/negocio';

const MANUALES = ['retiro_dueno', 'aportacion_dueno', 'transferencia', 'cobro_didi', 'saldo_inicial', 'ajuste_didi'];
const ORIGEN = {
  venta:           { texto: 'Viene de un pedido. Corrígelo en Pedidos (tócalo y Editar).', href: '/', boton: 'Ir a Pedidos' },
  compra_insumo:   { texto: 'Viene de una compra. Corrígela en Compras de insumos.', href: '/insumos', boton: 'Ir a Compras' },
  pago_obligacion: { texto: 'Es un pago de Por pagar. Edítalo o deshazlo desde Gastos.', href: '/gastos', boton: 'Ir a Por pagar' },
  ajuste_corte:    { texto: 'Es el ajuste de un corte de caja. Edítalo en "Cortes recientes".' },
};

export default function EditarMovimiento({ mov, movsGrupo, cuentas, onClose, onGuardado }) {
  const manual = MANUALES.includes(mov.tipo);
  const esPar = mov.tipo === 'transferencia' || mov.tipo === 'cobro_didi' || mov.tipo === 'ajuste_didi';
  const sale = movsGrupo.find((x) => Number(x.monto) < 0 && x.tipo !== 'ajuste_didi');
  const entra = movsGrupo.find((x) => Number(x.monto) > 0 && x.tipo !== 'ajuste_didi');
  const montoInicial = esPar ? Math.abs(Number((entra || sale || mov).monto)) : mov.tipo === 'saldo_inicial' ? Number(mov.monto) : Math.abs(Number(mov.monto));
  const [monto,   setMonto]   = useState(String(montoInicial));
  const [fecha,   setFecha]   = useState(String(mov.dia_operativo));
  const [desc,    setDesc]    = useState(mov.descripcion || '');
  const [cuenta,  setCuenta]  = useState(esPar ? sale?.cuenta_id : mov.cuenta_id);
  const [destino, setDestino] = useState(entra?.cuenta_id);
  const [guardando, setGuardando] = useState(false);

  const correr = async (fn) => {
    setGuardando(true);
    const { error } = await fn();
    setGuardando(false);
    if (error) { alert('No se guardó: ' + msgError(error)); return; }
    vibrar();
    onGuardado();
  };

  const guardar = () => correr(() => supabase.rpc('editar_movimiento', { p_mov: mov.id, p: {
    monto: parseFloat(monto), fecha, descripcion: desc,
    ...(mov.tipo === 'transferencia' ? { cuenta_id: cuenta, cuenta_destino: destino }
      : esPar ? { cuenta_destino: destino } : { cuenta_id: cuenta }),
  } }));
  const anular = () => correr(() => supabase.rpc('anular_movimiento', { p_mov: mov.id }));

  const tipoMov = esPar && mov.tipo === 'ajuste_didi' ? 'cobro_didi' : mov.tipo;
  const montoOk = mov.tipo === 'saldo_inicial' ? monto !== '' && !isNaN(parseFloat(monto)) : parseFloat(monto) > 0;

  return (
    <Sheet open title={TIPOS_MOVIMIENTO[tipoMov] || 'Movimiento'} onClose={onClose}>
      {!manual ? (
        <div className="space-y-3">
          <div className="rounded-card p-4" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
            <p className="font-bold text-ink">{mov.descripcion}</p>
            <p className="text-2xl font-display" style={{ color: Number(mov.monto) < 0 ? C.bad : C.ok, fontWeight: 700 }}>{formatMXN(mov.monto)}</p>
          </div>
          <p className="text-sm" style={{ color: C.dim }}>{ORIGEN[mov.tipo]?.texto || 'Este movimiento se corrige desde su origen.'}</p>
          {ORIGEN[mov.tipo]?.href && <Link href={ORIGEN[mov.tipo].href}><BotonPrincipal>{ORIGEN[mov.tipo].boton}</BotonPrincipal></Link>}
        </div>
      ) : (
        <>
          <div>
            <Label>{mov.tipo === 'cobro_didi' || mov.tipo === 'ajuste_didi' ? '¿CUÁNTO DEPOSITÓ DIDI?' : mov.tipo === 'saldo_inicial' ? 'MONTO (CON SIGNO)' : '¿CUÁNTO?'}</Label>
            <MontoInput value={monto} onChange={setMonto} />
          </div>
          {mov.tipo === 'transferencia' && (
            <>
              <div><Label>DE</Label><CuentaChips cuentas={cuentas} value={cuenta} onChange={setCuenta} /></div>
              <div><Label>A</Label><CuentaChips cuentas={cuentas.filter((c) => c.cuenta_id !== cuenta)} value={destino} onChange={setDestino} /></div>
            </>
          )}
          {(mov.tipo === 'cobro_didi' || mov.tipo === 'ajuste_didi') && (
            <div><Label>¿A DÓNDE LLEGÓ?</Label><CuentaChips cuentas={cuentas} value={destino} onChange={setDestino} excluir={['didi', 'caja']} /></div>
          )}
          {!esPar && (
            <div><Label>CUENTA</Label><CuentaChips cuentas={cuentas} value={cuenta} onChange={setCuenta} excluir={['didi']} /></div>
          )}
          <div><Label>FECHA</Label><TextInput type="date" value={fecha} onChange={setFecha} /></div>
          <div><Label>NOTA</Label><TextInput value={desc} onChange={setDesc} placeholder="Nota" /></div>
          <AccionesEdicion onGuardar={guardar} onEliminar={anular} onCancelar={onClose} guardando={guardando}
            puedeGuardar={montoOk && !!fecha && (mov.tipo !== 'transferencia' || (cuenta && destino && cuenta !== destino))}
            avisoEliminar="Se revierte en Caja; el movimiento queda en el historial de cambios." />
        </>
      )}
    </Sheet>
  );
}
