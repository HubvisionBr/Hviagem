import { useCallback, useSyncExternalStore } from "react";

export type Theme = "light" | "dark";
export const THEME_KEY = "hviagem-theme";

// Roda no <head> antes da pintura: aplica o tema salvo (ou o do sistema) sem piscar.
export const themeInitScript = `(function(){try{var t=localStorage.getItem("${THEME_KEY}");if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.classList.toggle("dark",t==="dark");}catch(e){}})();`;

function current(): Theme {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "dark" : "light";
}

const listeners = new Set<() => void>();
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, current, () => "light" as Theme);
  const setTheme = useCallback((t: Theme) => {
    document.documentElement.classList.toggle("dark", t === "dark");
    try {
      localStorage.setItem(THEME_KEY, t);
    } catch {
      /* modo privado: vale só nesta aba */
    }
    listeners.forEach((l) => l());
  }, []);
  return { theme, setTheme, toggle: () => setTheme(current() === "dark" ? "light" : "dark") };
}
