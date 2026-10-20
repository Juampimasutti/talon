import dynamic from "next/dynamic";
import { ScreenFallback } from "@/components/screen-fallback";

const Screen = dynamic(() => import("@/components/tablero/tablero-screen").then((mod) => mod.TableroScreen), {
  loading: () => <ScreenFallback />,
});

export default function Page() {
  return <Screen />;
}
