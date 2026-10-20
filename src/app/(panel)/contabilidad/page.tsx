import dynamic from "next/dynamic";
import { ScreenFallback } from "@/components/screen-fallback";

const Screen = dynamic(() => import("@/components/contabilidad/contabilidad-screen").then((mod) => mod.ContabilidadScreen), {
  loading: () => <ScreenFallback />,
});

export default function Page() {
  return <Screen />;
}
