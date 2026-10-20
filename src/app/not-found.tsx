import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center px-6">
      <div className="max-w-md text-center">
        <p className="text-sm text-muted-foreground">404</p>
        <h1 className="mt-2 text-3xl">Esa pantalla no existe</h1>
        <p className="mt-2 text-muted-foreground">Volvé al tablero y seguí desde ahí.</p>
        <Link href="/tablero" className="mt-6 inline-flex rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground">
          Ir al tablero
        </Link>
      </div>
    </main>
  );
}
