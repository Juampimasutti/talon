export function ScreenFallback({ label = "Cargando" }: { label?: string }) {
  return (
    <div className="grid gap-3 p-4 md:p-6" aria-busy="true" aria-live="polite">
      <div className="h-8 w-48 animate-pulse rounded-md bg-muted" />
      <div className="h-4 w-72 animate-pulse rounded-md bg-muted" />
      <div className="mt-4 h-64 animate-pulse rounded-xl bg-muted" />
      <p className="sr-only">{label}</p>
    </div>
  );
}
