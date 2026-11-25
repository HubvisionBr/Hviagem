import { Link, useLocation } from "@tanstack/react-router";
import { useNavItems } from "@/components/nav";

// Navegação compacta para celular e tablet (no desktop a sidebar assume).
export function BottomNav() {
  const loc = useLocation();
  const items = useNavItems();

  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-50 border-t border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/85 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto max-w-2xl grid" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((t) => {
          const active = loc.pathname.startsWith(t.to);
          const Icon = t.icon;
          return (
            <Link
              key={t.to}
              to={t.to}
              className={`relative flex flex-col items-center justify-center gap-1 py-3 text-[11px] font-medium transition-colors ${
                active ? "text-primary dark:text-[var(--color-brand-secondary)]" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="size-5" strokeWidth={active ? 2.4 : 1.8} />
              <span className="font-sans">{t.short}</span>
              {t.badge > 0 && (
                <span className="absolute top-1.5 right-[calc(50%-28px)] min-w-4 h-4 px-1 rounded-full bg-[var(--color-status-pending)] text-white text-[10px] font-bold flex items-center justify-center font-mono-ledger">
                  {t.badge}
                </span>
              )}
              {active && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 h-[3px] w-8 rounded-b-full bg-[var(--color-brand-secondary)]" />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
