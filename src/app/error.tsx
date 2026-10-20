"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="grid min-h-screen place-items-center px-6">
      <div className="max-w-md text-center">
        <h1 className="text-3xl">Algo se rompió en esta pantalla</h1>
        <p className="mt-2 text-muted-foreground">Podés reintentar. Si sigue, volvé a entrar.</p>
        <button type="button" className="mt-6 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground" onClick={reset}>
          Reintentar
        </button>
      </div>
    </main>
  );
}
