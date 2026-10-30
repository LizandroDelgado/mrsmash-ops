'use client';
// Piezas compartidas. Los colores son tokens de marca (app/globals.css): nunca hex aquí.
import Link from 'next/link';
import { X, ChevronLeft } from 'lucide-react';

const v = (n) => `var(--${n})`;
export const C = {
  // superficies y texto
  bg: v('cream'), surface: v('paper'), surface2: v('paper-2'), border: v('line'),
  ink: v('ink'), dim: v('ink-soft'), dimmer: v('ink-mute'),
  // marca
  brand: v('orange'), brandDeep: v('orange-deep'), brandText: v('orange-text'), brandFill: v('orange-fill'),
  onBrand: v('on-orange'), brandSoft: v('orange-soft'), brandLine: v('orange-line'),
  // semánticos (texto AA en ambos temas) y sus fondos suaves
  ok: v('good-ink'), warn: v('warn-ink'), bad: v('bad-ink'), onBad: v('on-bad'),
  okSoft: v('good-soft'), warnSoft: v('warn-soft'), badSoft: v('bad-soft'),
  okLine: v('good-line'), warnLine: v('warn-line'), badLine: v('bad-line'),
  // banda oscura fija
  band: v('band'), bandInk: v('band-ink'), bandInkSoft: v('band-ink-soft'), bandLine: v('band-line'),
  bandGood: v('band-good'), bandWarn: v('band-warn'), bandBad: v('band-bad'), bandAccent: v('band-accent'),
  overlay: v('overlay'),
};

export function Logo({ height = 32 }) {
  return (
    <>
      <img src="/brand/mrsmash-logo.png" alt="MR. SMASH" className="logo-light" style={{ height, width: 'auto' }} />
      <img src="/brand/mrsmash-logo-white.png" alt="MR. SMASH" className="logo-dark" style={{ height, width: 'auto' }} />
    </>
  );
}

// Encabezado: logo + título de la pantalla en Fredoka. back = href o función para "volver".
export function Header({ titulo, subtitulo, right, back }) {
  const btnBack = { width: 44, height: 44, minHeight: 44, background: C.surface2 };
  return (
    <header className="sticky top-0 z-40 flex items-center gap-3 px-4"
      style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, minHeight: 60 }}>
      {back && (typeof back === 'string' ? (
        <Link href={back} aria-label="Volver" className="flex items-center justify-center rounded-full shrink-0" style={btnBack}>
          <ChevronLeft size={22} style={{ color: C.ink }} />
        </Link>
      ) : (
        <button type="button" onClick={back} aria-label="Volver" className="flex items-center justify-center rounded-full shrink-0" style={btnBack}>
          <ChevronLeft size={22} style={{ color: C.ink }} />
        </button>
      ))}
      {!back && <span className="shrink-0 flex items-center"><Logo /></span>}
      {titulo && (
        <div className="flex-1 min-w-0">
          <h1 className="truncate text-lg leading-tight" style={{ color: C.ink, fontWeight: 600 }}>{titulo}</h1>
          {subtitulo && <p className="text-xs truncate" style={{ color: C.dim }}>{subtitulo}</p>}
        </div>
      )}
      {!titulo && <span className="flex-1" />}
      {right}
    </header>
  );
}

export function Label({ children, color = C.dim, className = '' }) {
  return <p className={`text-xs font-bold tracking-wider mb-2 ${className}`} style={{ color }}>{children}</p>;
}

// Tarjeta base: paper, radio 22, borde line, sin sombra
export function Card({ children, className = '', style }) {
  return (
    <div className={`rounded-card p-4 ${className}`} style={{ background: C.surface, border: `1px solid ${C.border}`, ...style }}>
      {children}
    </div>
  );
}

// Selector de opciones en chips (pastilla). Seleccionado: relleno naranja (orange-fill: AA con texto chico).
export function Chips({ options, value, onChange, wrap = false }) {
  return (
    <div className={`flex gap-2 ${wrap ? 'flex-wrap' : ''}`}>
      {options.map(({ key, label }) => {
        const activo = value === key;
        return (
          <button key={String(key)} type="button" onClick={() => onChange(key)} aria-pressed={activo}
            className={`${wrap ? 'px-4' : 'flex-1 px-1'} py-3 rounded-full text-sm`}
            style={{
              minHeight: 48,
              background: activo ? C.brandFill : C.surface,
              color:      activo ? C.onBrand : C.ink,
              border:     `1px solid ${activo ? C.brandFill : C.border}`,
            }}>
            {label}
          </button>
        );
      })}
    </div>
  );
}

const inputStyle = { background: C.surface, border: `1px solid ${C.border}`, color: C.ink, borderRadius: 14 };

export function MontoInput({ value, onChange, autoFocus = false, placeholder = '0' }) {
  return (
    <div className="relative">
      <span className="absolute left-4 top-1/2 -translate-y-1/2 font-display text-lg" style={{ color: C.dim, fontWeight: 600 }}>$</span>
      <input type="number" inputMode="decimal" step="0.01" value={value} autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full pl-10 pr-4 py-3 outline-none font-display"
        style={{ ...inputStyle, fontSize: 22, fontWeight: 600, minHeight: 56 }} />
    </div>
  );
}

// Cantidad con su unidad a la derecha (kg, g, pza…). big = conteo, input enorme.
export function CantidadInput({ value, onChange, unidad, autoFocus = false, big = false, placeholder = '0', onEnter }) {
  return (
    <div className="relative">
      <input type="number" inputMode="decimal" step="any" value={value} autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        onKeyDown={(e) => { if (e.key === 'Enter' && onEnter) onEnter(); }}
        className="w-full pl-4 pr-16 outline-none font-display"
        style={{ ...inputStyle, fontSize: big ? 40 : 20, fontWeight: 600, minHeight: big ? 88 : 52 }} />
      <span className="absolute right-4 top-1/2 -translate-y-1/2 font-bold" style={{ color: C.dim, fontSize: big ? 22 : 16 }}>
        {unidad}
      </span>
    </div>
  );
}

export function TextInput({ value, onChange, placeholder, type = 'text', inputMode }) {
  return (
    <input type={type} inputMode={inputMode} value={value} onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-4 py-3 outline-none"
      style={{ ...inputStyle, fontSize: 16, minHeight: 48 }} />
  );
}

// Botón principal: pastilla naranja, Fredoka 600 de 20px (texto grande: AA 3:1 con blanco).
// variante "peligro" para acciones destructivas o de pérdida (merma).
export function BotonPrincipal({ children, onClick, disabled, variante = 'principal' }) {
  const peligro = variante === 'peligro';
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`w-full py-3 rounded-full text-xl ${peligro ? '' : 'btn-primary'}`}
      style={peligro
        ? { background: disabled ? C.surface2 : C.bad, color: disabled ? C.dimmer : C.onBad, minHeight: 56, fontWeight: 600 }
        : { minHeight: 56, fontWeight: 600 }}>
      {children}
    </button>
  );
}

// Botón secundario: pastilla con borde
export function BotonSecundario({ children, onClick, disabled, peligro = false, className = '' }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`w-full px-4 rounded-full text-base ${className}`}
      style={{ background: C.surface, border: `1px solid ${C.border}`, color: peligro ? C.bad : C.ink, minHeight: 48 }}>
      {children}
    </button>
  );
}

// Hoja inferior modal: se abre con un toque, se guarda con otro.
export function Sheet({ open, title, onClose, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end" style={{ background: C.overlay }}
      onClick={onClose}>
      <div className="px-4 pt-3 space-y-4 overflow-y-auto"
        style={{ background: C.bg, borderTop: `1px solid ${C.border}`, maxHeight: '92vh',
                 borderRadius: '22px 22px 0 0', paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-xl" style={{ color: C.ink, fontWeight: 600 }}>{title}</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar"
            className="flex items-center justify-center rounded-full" style={{ width: 48, background: C.surface, border: `1px solid ${C.border}` }}>
            <X size={20} style={{ color: C.ink }} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Estado vacío: mascota, título en Fredoka y botón principal hacia la captura
export function Vacio({ titulo, texto, accion, onAccion }) {
  return (
    <div className="flex flex-col items-center text-center gap-3 py-8 px-4 rounded-card"
      style={{ background: C.surface, border: `1px dashed ${C.border}` }}>
      <Logo height={44} />
      <h2 className="text-xl" style={{ color: C.ink, fontWeight: 600 }}>{titulo}</h2>
      {texto && <p className="text-sm" style={{ color: C.dim }}>{texto}</p>}
      {accion && (
        <button type="button" onClick={onAccion} className="btn-primary px-6 rounded-full text-lg" style={{ minHeight: 52, fontWeight: 600 }}>
          {accion}
        </button>
      )}
    </div>
  );
}

export function Cargando() {
  return (
    <div className="flex justify-center py-12" role="status" aria-label="Cargando">
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
