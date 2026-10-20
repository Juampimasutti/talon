import dynamic from "next/dynamic";
import { ScreenFallback } from "@/components/screen-fallback";

const Screen = dynamic(() => import("@/components/configuracion/configuracion-screen").then((mod) => mod.ConfiguracionScreen), {
  loading: () => <ScreenFallback />,
});

export default function Page() {
  return <Screen />;
}
