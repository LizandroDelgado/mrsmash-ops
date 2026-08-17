'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, ClipboardList, ShoppingBag, BarChart2, TrendingUp } from 'lucide-react';

const tabs = [
  { href: '/', icon: Home, label: 'Inicio' },
  { href: '/insumos', icon: ShoppingBag, label: 'Insumos' },
  { href: '/finanzas', icon: BarChart2, label: 'Finanzas' },
  { href: '/dashboard', icon: TrendingUp, label: 'Dashboard' },
  { href: '/importar', icon: ClipboardList, label: 'Didi' },
];

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 border-t"
      style={{
        background: '#0a0a0a',
        borderColor: '#2a2a2a',
        paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
      }}
    >
      <div className="flex">
        {tabs.map(({ href, icon: Icon, label }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className="flex-1 flex flex-col items-center justify-center pt-3 pb-1 gap-1"
              style={{ color: active ? '#FF4D00' : '#666' }}
            >
              <Icon size={22} strokeWidth={active ? 2.5 : 1.5} />
              <span className="text-xs font-medium">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
