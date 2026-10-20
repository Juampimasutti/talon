import dynamic from "next/dynamic";
import { ScreenFallback } from "@/components/screen-fallback";

const Screen = dynamic(() => import("@/components/articulos/articulos-screen").then((mod) => mod.ArticulosScreen), {
  loading: () => <ScreenFallback />,
});

export default function Page() {
  return <Screen />;
}
