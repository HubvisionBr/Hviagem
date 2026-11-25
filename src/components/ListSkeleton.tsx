import { Skeleton } from "@/components/ui/skeleton";

// Esqueleto de carregamento das listas (no lugar do texto "Carregando…").
export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <ul className="space-y-3" aria-busy="true" aria-label="Carregando">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="rounded-xl border border-border bg-card p-4 shadow-card">
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-4 w-16" />
          </div>
          <Skeleton className="mt-3 h-3 w-1/3" />
        </li>
      ))}
    </ul>
  );
}
