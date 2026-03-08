import { Outlet, Link, useLocation } from 'react-router-dom';

export function Layout() {
  const location = useLocation();

  const navLinks = [
    { to: '/', label: 'Sessions' },
    { to: '/settings', label: 'Settings' },
  ];

  return (
    <div className="min-h-screen bg-hawk-bg">
      <nav className="sticky top-0 z-50 border-b border-hawk-border bg-hawk-bg/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-hawk-orange text-xs font-bold text-black">
              H
            </div>
            <span className="font-mono text-sm font-semibold text-hawk-text">
              Hawkeye
            </span>
          </Link>
          <div className="flex gap-6 font-mono text-xs text-hawk-text3">
            {navLinks.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className={`transition-colors hover:text-hawk-text ${
                  location.pathname === link.to ? 'text-hawk-orange' : ''
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      </nav>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
