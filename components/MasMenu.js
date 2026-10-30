'use client';
// Menú "Más" del encabezado: pantallas que salieron de la barra inferior.
import { useState } from 'react';
import Link from 'next/link';
import { MoreVertical, ShoppingBag, BookOpen, BarChart2, ClipboardList, Settings } from 'lucide-react';
import { Sheet, C } from '@/components/ui';

const ITEMS = [
  { href: '/insumos',       icon: ShoppingBag,   label: 'Compras de insumos' },
  { href: '/inventario/recetas', icon: BookOpen, label: 'Recetas y costos' },
  { href: '/finanzas',      icon: BarChart2,     label: 'Finanzas (semana / mes)' },
  { href: '/importar',      icon: ClipboardList, label: 'Importar Didi' },
  { href: '/configuracion', icon: Settings,      label: 'Configuración y saldos' },
];

export default function MasMenu() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Más opciones"
        className="flex items-center justify-center rounded-xl" style={{ width: 48, background: C.surface2 }}>
        <MoreVertical size={20} style={{ color: C.dim }} />
      </button>
      <Sheet open={open} title="Más" onClose={() => setOpen(false)}>
        <div className="space-y-2">
          {ITEMS.map(({ href, icon: Icon, label }) => (
            <Link key={href} href={href} onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-4 rounded-2xl font-bold text-white"
              style={{ background: C.surface, minHeight: 56 }}>
              <Icon size={20} style={{ color: C.brand }} />{label}
            </Link>
          ))}
        </div>
      </Sheet>
    </>
  );
}
