'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

const navigation = [
  { href: '/fridge', label: '冰箱' },
  { href: '/fridge/notifications', label: '提醒' },
  { href: '/fridge/meals', label: '餐食' },
  { href: '/fridge/wellness', label: '健康' },
  { href: '/fridge/foods', label: '食材百科' },
  { href: '/fridge/timeline', label: '动态' },
  { href: '/fridge/settings', label: '设置' },
];

interface Props {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  showNavigation?: boolean;
  compact?: boolean;
}

export function AppHeader({
  title,
  subtitle,
  actions,
  showNavigation = true,
  compact = true,
}: Props) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === '/fridge' ? pathname === href : pathname.startsWith(href);

  return (
    <>
      <header className="app-header">
        <div className="app-header-inner">
          <Link href="/fridge" className="brand" aria-label="鲜知首页">
            <span className="brand-mark" aria-hidden="true">
              <Image src="/mascot/xiaozhi.png" alt="" width={40} height={40} priority />
            </span>
            <span className="brand-name">鲜知</span>
          </Link>
          {showNavigation ? (
            <nav className="desktop-nav" aria-label="主导航">
              {navigation.map((item) => (
                <Link
                  className={isActive(item.href) ? 'active' : ''}
                  href={item.href}
                  key={item.href}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          ) : null}
          <div className="header-actions">{actions}</div>
        </div>
        <div className={`page-heading container${compact ? ' compact' : ''}`}>
          <div>
            <h1>{title}</h1>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
        </div>
      </header>
      {showNavigation ? (
        <nav className="mobile-nav" aria-label="移动端主导航">
          {navigation.slice(0, 4).map((item) => (
            <Link className={isActive(item.href) ? 'active' : ''} href={item.href} key={item.href}>
              {item.label}
            </Link>
          ))}
          <Link
            className={
              pathname.startsWith('/fridge/settings') ||
              pathname.startsWith('/fridge/foods') ||
              pathname.startsWith('/fridge/timeline')
                ? 'active'
                : ''
            }
            href="/fridge/settings"
          >
            更多
          </Link>
        </nav>
      ) : null}
    </>
  );
}
