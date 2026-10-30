'use client';
// Menú "Más" del encabezado: pantallas que salieron de la barra inferior.
import { useState } from 'react';
import Link from 'next/link';
import { MoreVertical, Tags, ShoppingBag, ClipboardList, Settings } from 'lucide-react';
import { Sheet, C } from '@/components/ui';

// Recetas se editan en Precios y costos; /inventario/recetas sigue disponible desde Inventario.
const ITEMS = [
  { href: '/configuracion/precios-costos', icon: Tags, label: 'Precios y costos' },
  { href: '/insumos',       icon: ShoppingBag,   label: 'Compras de insumos' },
  { href: '/importar',      icon: ClipboardList, label: 'Importar Didi' },
  { href: '/configuracion', icon: Settings,      label: 'Configuración y saldos' },
];

export default function MasMenu() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Más opciones"
        className="flex items-center justify-center rounded-full" style={{ width: 48, background: C.surface2 }}>
        <MoreVertical size={20} style={{ color: C.dim }} />
      </button>
      <Sheet open={open} title="Más" onClose={() => setOpen(false)}>
        <div className="space-y-2">
          {ITEMS.map(({ href, icon: Icon, label }) => (
            <Link key={href} href={href} onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-4 rounded-full font-bold text-ink"
              style={{ background: C.surface, border: `1px solid ${C.border}`, minHeight: 56 }}>
              <Icon size={20} style={{ color: C.brandText }} />{label}
            </Link>
          ))}
        </div>
      </Sheet>
    </>
  );
}
