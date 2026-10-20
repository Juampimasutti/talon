import dynamic from "next/dynamic";
import { ScreenFallback } from "@/components/screen-fallback";

const Screen = dynamic(() => import("@/components/directorio/directorio-screen").then((mod) => mod.DirectorioScreen), {
  loading: () => <ScreenFallback />,
});

export default function Page() {
  return <Screen kind="clientes" />;
}
