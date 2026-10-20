import dynamic from "next/dynamic";
import { ScreenFallback } from "@/components/screen-fallback";

const Screen = dynamic(() => import("@/components/datos/datos-screen").then((mod) => mod.DatosScreen), {
  loading: () => <ScreenFallback label="Cargando datos" />,
});

export default function Page() {
  return <Screen />;
}
