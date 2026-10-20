import dynamic from "next/dynamic";
import { ScreenFallback } from "@/components/screen-fallback";

const Screen = dynamic(() => import("@/components/informes/informes-screen").then((mod) => mod.InformesScreen), {
  loading: () => <ScreenFallback label="Cargando informes" />,
});

export default function Page() {
  return <Screen />;
}
