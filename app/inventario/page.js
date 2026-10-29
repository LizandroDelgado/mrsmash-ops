'use client';
import Link from 'next/link';
import { ShoppingBag } from 'lucide-react';
import BottomNav from '@/components/BottomNav';
import MasMenu from '@/components/MasMenu';
import { Header, Vacio, C } from '@/components/ui';

// Placeholder: el inventario llega en la Fase 2 (ver docs/ERP_PLAN.md).
export default function InventarioPage() {
  return (
    <div className="flex flex-col min-h-screen" style={{ background: C.bg }}>
      <Header right={<MasMenu />} />
      <main className="flex-1 px-4 pt-4 pb-32 space-y-4">
        <Vacio emoji="📦" titulo="Inventario: próximamente"
          texto="Aquí vas a ver cuánto tienes de carne, pan y empaque, y cuánto necesitas comprar." />
        <Link href="/insumos" className="flex items-center justify-center gap-2 rounded-2xl font-bold"
          style={{ background: C.brand, color: '#fff', minHeight: 56 }}>
          <ShoppingBag size={18} /> Registrar compra de insumos
        </Link>
      </main>
      <BottomNav />
    </div>
  );
}
