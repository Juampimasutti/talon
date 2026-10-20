import dynamic from "next/dynamic";
import { ScreenFallback } from "@/components/screen-fallback";

const Screen = dynamic(() => import("@/components/reparto/reparto-screen").then((mod) => mod.RepartoScreen), {
  loading: () => <ScreenFallback label="Cargando el reparto" />,
});

export default function Page() {
  return <Screen />;
}
