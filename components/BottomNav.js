'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Wallet, Receipt, Package, TrendingUp } from 'lucide-react';
import { C } from '@/components/ui';

const tabs = [
  { href: '/',           icon: Home,       label: 'Pedidos' },
  { href: '/caja',       icon: Wallet,     label: 'Caja' },
  { href: '/gastos',     icon: Receipt,    label: 'Gastos' },
  { href: '/inventario', icon: Package,    label: 'Inventario' },
  { href: '/dashboard',  icon: TrendingUp, label: 'Dashboard' },
];

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50"
      style={{
        background: C.surface,
        borderTop: `1px solid ${C.border}`,
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <div className="flex px-1 py-1" style={{ minHeight: 64 }}>
        {tabs.map(({ href, icon: Icon, label }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className="flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 rounded-full font-display"
              style={{ color: active ? C.brandText : C.dim, background: active ? C.brandSoft : 'transparent', minHeight: 56, fontWeight: 600 }}
            >
              <Icon size={22} strokeWidth={active ? 2.5 : 1.75} />
              <span className="text-xs truncate max-w-full">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
