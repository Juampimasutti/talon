import dynamic from "next/dynamic";
import { ScreenFallback } from "@/components/screen-fallback";

const Screen = dynamic(() => import("@/components/documentos/detalle-screen").then((mod) => mod.DetalleScreen), {
  loading: () => <ScreenFallback />,
});

export default function Page() {
  return <Screen kind="remito" />;
}
