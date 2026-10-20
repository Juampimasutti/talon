import dynamic from "next/dynamic";
import { ScreenFallback } from "@/components/screen-fallback";

const Screen = dynamic(() => import("@/components/documentos/lista-screen").then((mod) => mod.ListaScreen), {
  loading: () => <ScreenFallback />,
});

export default function Page() {
  return <Screen kind="venta" />;
}
