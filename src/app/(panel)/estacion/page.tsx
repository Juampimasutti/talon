import dynamic from "next/dynamic";
import { ScreenFallback } from "@/components/screen-fallback";

const Screen = dynamic(() => import("@/components/estacion/estacion-screen").then((mod) => mod.EstacionScreen), {
  loading: () => <ScreenFallback label="Cargando la estación" />,
});

export default function Page() {
  return <Screen />;
}
