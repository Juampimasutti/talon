import dynamic from "next/dynamic";
import { ScreenFallback } from "@/components/screen-fallback";

const Screen = dynamic(() => import("@/components/documentos/editor-screen").then((mod) => mod.EditorScreen), {
  loading: () => <ScreenFallback />,
});

export default function Page() {
  return <Screen kind="compra" />;
}
