import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { LogOut, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useNavItems } from "@/components/nav";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { isAdmin, useProfile } from "@/lib/profile";

const COLLAPSE_KEY = "hviagem-sidebar-recolhida";
const itemBase = "flex w-full items-center gap-3 rounded-lg h-10 text-sm font-medium transition-colors";
const itemIdle = "text-muted-foreground hover:bg-muted hover:text-foreground";

// Sidebar fixa do desktop (240px), recolhível; a preferência fica salva no navegador.
export function AppSidebar() {
  const loc = useLocation();
  const navigate = useNavigate();
  const profile = useProfile();
  const items = useNavItems();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      /* sem storage */
    }
  }, []);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
    } catch {
      /* sem storage */
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  const pad = collapsed ? "justify-center px-0" : "px-3";

  return (
    <aside
      className={`hidden md:flex sticky top-0 h-screen shrink-0 flex-col border-r border-border bg-card transition-[width] duration-200 ${
        collapsed ? "w-[72px]" : "w-60"
      }`}
    >
      <div className={`flex h-16 shrink-0 items-center border-b border-border ${collapsed ? "justify-center px-2" : "px-5"}`}>
        {collapsed ? <Logo variant="icon" className="h-9 w-auto" /> : <Logo className="h-8 w-auto" />}
      </div>

      <nav className="flex-1 overflow-y-auto p-3 space-y-1" aria-label="Navegação principal">
        {items.map((t) => {
          const active = loc.pathname.startsWith(t.to);
          const Icon = t.icon;
          return (
            <Link
              key={t.to}
              to={t.to}
              title={collapsed ? t.label : undefined}
              aria-current={active ? "page" : undefined}
              className={`relative ${itemBase} ${pad} ${
                active ? "bg-[var(--color-soft-accent)] text-primary dark:text-[var(--color-brand-secondary)]" : itemIdle
              }`}
            >
              <Icon className="size-[18px] shrink-0" strokeWidth={active ? 2.3 : 1.9} />
              {!collapsed && <span className="truncate flex-1">{t.label}</span>}
              {t.badge > 0 && (
                <span
                  className={`min-w-5 h-5 px-1.5 rounded-full bg-[var(--color-status-pending)] text-white text-[11px] font-bold flex items-center justify-center font-mono-ledger ${
                    collapsed ? "absolute top-0.5 right-1.5" : ""
                  }`}
                >
                  {t.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border p-3 space-y-1">
        {!collapsed && (
          <div className="px-3 pb-2">
            <div className="text-sm font-semibold truncate">{profile.nome}</div>
            <div className="text-xs text-muted-foreground truncate">{isAdmin(profile) ? "Administrador" : "Colaborador"}</div>
          </div>
        )}
        {collapsed ? <ThemeToggle className="w-full" /> : <ThemeToggle withLabel />}
        <button type="button" onClick={logout} title="Sair" className={`${itemBase} ${itemIdle} ${pad}`}>
          <LogOut className="size-[18px] shrink-0" />
          {!collapsed && <span>Sair</span>}
        </button>
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
          title={collapsed ? "Expandir menu" : "Recolher menu"}
          className={`${itemBase} ${itemIdle} ${pad}`}
        >
          {collapsed ? <PanelLeftOpen className="size-[18px]" /> : <PanelLeftClose className="size-[18px]" />}
          {!collapsed && <span>Recolher menu</span>}
        </button>
      </div>
    </aside>
  );
}
