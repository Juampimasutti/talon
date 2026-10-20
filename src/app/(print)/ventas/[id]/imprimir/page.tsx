import dynamic from "next/dynamic";
import { ScreenFallback } from "@/components/screen-fallback";

const Screen = dynamic(() => import("@/components/documentos/imprimir-screen").then((mod) => mod.ImprimirScreen), {
  loading: () => <ScreenFallback label="Armando la impresión" />,
});

export default function Page() {
  return <Screen kind="venta" />;
}
