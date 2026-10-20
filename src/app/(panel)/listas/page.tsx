import dynamic from "next/dynamic";
import { ScreenFallback } from "@/components/screen-fallback";

const Screen = dynamic(() => import("@/components/listas/listas-screen").then((mod) => mod.ListasScreen), {
  loading: () => <ScreenFallback />,
});

export default function Page() {
  return <Screen />;
}
