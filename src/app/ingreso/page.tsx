import dynamic from "next/dynamic";
import { ScreenFallback } from "@/components/screen-fallback";

const IngresoScreen = dynamic(() => import("@/components/ingreso/ingreso-screen").then((mod) => mod.IngresoScreen), {
  loading: () => <ScreenFallback label="Cargando ingreso" />,
});

export default function Page() {
  return <IngresoScreen />;
}
