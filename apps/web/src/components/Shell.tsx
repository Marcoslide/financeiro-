'use client';

import { ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';

const NAV = [
  { group: 'Operação', items: [
    { href: '/dashboard', label: 'Dashboard', ic: '▦', soon: false },
    { href: '/importacoes', label: 'Importações', ic: '⭱', soon: true },
    { href: '/conciliacao', label: 'Conciliação', ic: '⇄', soon: true },
    { href: '/pendencias', label: 'Pendências', ic: '⚑', soon: true },
  ]},
  { group: 'Dados', items: [
    { href: '/pedidos', label: 'Pedidos', ic: '▤', soon: true },
    { href: '/movimentacoes', label: 'Movimentações', ic: '₿', soon: true },
    { href: '/produtos', label: 'Produtos e custos', ic: '◫', soon: true },
  ]},
  { group: 'Gestão', items: [
    { href: '/usuarios', label: 'Usuários', ic: '👤', soon: false },
    { href: '/lojas', label: 'Lojas', ic: '🏬', soon: false },
    { href: '/auditoria', label: 'Auditoria', ic: '📜', soon: false },
  ]},
];

const CRUMB: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/usuarios': 'Usuários',
  '/lojas': 'Lojas',
  '/auditoria': 'Auditoria',
};

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, clear } = useAuth();

  const initials = (user?.name ?? 'US')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  function logout() {
    clear();
    router.replace('/login');
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="logo-badge">CS</div>
          <div>
            <b>Conciliação</b>
            <small>Shopee · Financeiro</small>
          </div>
        </div>
        <nav className="nav">
          {NAV.map((g) => (
            <div key={g.group}>
              <div className="nav-group">{g.group}</div>
              {g.items.map((it) =>
                it.soon ? (
                  <a key={it.href} className="soon" title="Disponível nos próximos blocos">
                    <span className="ic">{it.ic}</span>
                    {it.label}
                    <span className="soon-tag">em breve</span>
                  </a>
                ) : (
                  <Link
                    key={it.href}
                    href={it.href}
                    className={pathname === it.href ? 'active' : ''}
                  >
                    <span className="ic">{it.ic}</span>
                    {it.label}
                  </Link>
                ),
              )}
            </div>
          ))}
        </nav>
      </aside>

      <div className="main">
        <div className="topbar">
          <div className="crumbs">
            Início / <b>{CRUMB[pathname] ?? ''}</b>
          </div>
          <div className="spacer" />
          <div className="top-store">
            <span className="dot" /> Loja: <b>lidermolduras</b>
          </div>
          <div className="avatar" title={user?.email}>
            {initials}
          </div>
          <button className="logout" onClick={logout}>
            Sair
          </button>
        </div>
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
