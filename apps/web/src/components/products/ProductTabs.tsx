'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/produtos', label: 'Produtos' },
  { href: '/produtos/familias', label: 'Famílias' },
  { href: '/produtos/importacoes', label: 'Importações' },
];

/** Abas do módulo de Produtos (prompt §2). */
export function ProductTabs() {
  const pathname = usePathname();
  return (
    <div className="tabs">
      {TABS.map((t) => {
        const active = t.href === '/produtos' ? pathname === '/produtos' : pathname.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href} className={`tab ${active ? 'active' : ''}`}>
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
