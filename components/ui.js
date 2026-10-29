'use client';
// Piezas compartidas para las pantallas del ERP. Mismos colores y radios que el resto de la app.
import { X } from 'lucide-react';

export const C = {
  brand: '#FF4D00', bg: '#0a0a0a', surface: '#141414', surface2: '#1e1e1e',
  border: '#2a2a2a', dim: '#888', dimmer: '#666', ok: '#22c55e', warn: '#eab308', bad: '#ef4444',
};

export function Header({ right }) {
  return (
    <header className="sticky top-0 z-40 flex items-center justify-between px-4 py-3"
      style={{ background: C.bg, borderBottom: `1px solid ${C.surface2}` }}>
      <img src="/logo.png" alt="MR. SMASH" style={{ height: '36px', width: 'auto' }} />
      {right}
    </header>
  );
}

export function Label({ children, color = C.dim, className = '' }) {
  return <p className={`text-xs font-bold tracking-wider mb-2 ${className}`} style={{ color }}>{children}</p>;
}

// Selector de opciones en chips grandes. options: [{ key, label }]
export function Chips({ options, value, onChange, wrap = false }) {
  return (
    <div className={`flex gap-2 ${wrap ? 'flex-wrap' : ''}`}>
      {options.map(({ key, label }) => {
        const activo = value === key;
        return (
          <button key={String(key)} type="button" onClick={() => onChange(key)}
            className={`${wrap ? 'px-4' : 'flex-1 px-1'} py-3 rounded-xl font-bold text-sm`}
            style={{
              minHeight: 48,
              background: activo ? C.brand : C.surface,
              color:      activo ? '#fff'  : C.dim,
              border:     `1px solid ${activo ? C.brand : C.border}`,
            }}>
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function MontoInput({ value, onChange, autoFocus = false, placeholder = '0' }) {
  return (
    <div className="relative">
      <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-lg" style={{ color: C.dim }}>$</span>
      <input type="number" inputMode="decimal" step="0.01" value={value} autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full pl-10 pr-4 py-3 rounded-xl text-white placeholder-zinc-600 outline-none font-bold"
        style={{ background: C.surface, border: `1px solid ${C.border}`, fontSize: 22, minHeight: 56 }} />
    </div>
  );
}

export function TextInput({ value, onChange, placeholder, type = 'text', inputMode }) {
  return (
    <input type={type} inputMode={inputMode} value={value} onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-4 py-3 rounded-xl text-white placeholder-zinc-600 outline-none"
      style={{ background: C.surface, border: `1px solid ${C.border}`, fontSize: 16, minHeight: 48, colorScheme: 'dark' }} />
  );
}

export function BotonPrincipal({ children, onClick, disabled, color = C.brand }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className="w-full py-4 rounded-2xl font-bold text-lg"
      style={{ background: disabled ? C.surface2 : color, color: disabled ? '#444' : '#fff', minHeight: 56 }}>
      {children}
    </button>
  );
}

// Hoja inferior modal: se abre con un toque, se guarda con otro.
export function Sheet({ open, title, onClose, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end" style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={onClose}>
      <div className="rounded-t-3xl px-4 pt-3 space-y-4 overflow-y-auto"
        style={{ background: C.bg, border: `1px solid ${C.border}`, maxHeight: '92vh',
                 paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="font-bold text-lg text-white">{title}</p>
          <button type="button" onClick={onClose} aria-label="Cerrar"
            className="flex items-center justify-center rounded-xl" style={{ width: 48, background: C.surface2 }}>
            <X size={20} style={{ color: C.dim }} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Vacio({ emoji, titulo, texto, accion, onAccion }) {
  return (
    <div className="flex flex-col items-center text-center gap-3 py-8 px-4 rounded-2xl"
      style={{ background: C.surface, border: `1px dashed ${C.border}` }}>
      <p className="text-4xl">{emoji}</p>
      <p className="font-bold text-white">{titulo}</p>
      {texto && <p className="text-sm" style={{ color: C.dim }}>{texto}</p>}
      {accion && (
        <button type="button" onClick={onAccion} className="px-5 py-3 rounded-xl font-bold text-sm"
          style={{ background: C.brand, color: '#fff' }}>
          {accion}
        </button>
      )}
    </div>
  );
}

export function Cargando() {
  return (
    <div className="flex justify-center py-12">
      <div className="w-8 h-8 rounded-full border-2 animate-spin"
        style={{ borderColor: C.brand, borderTopColor: 'transparent' }} />
    </div>
  );
}

// Selector de cuenta en chips (usa filas de v_saldos_cuentas o cuentas)
export function CuentaChips({ cuentas, value, onChange, excluir = [] }) {
  const opciones = cuentas
    .filter((c) => !excluir.includes(c.clave))
    .map((c) => ({ key: c.cuenta_id || c.id, label: c.nombre.replace('Terminal/Transferencias', 'Terminal') }));
  return <Chips options={opciones} value={value} onChange={onChange} wrap />;
}
