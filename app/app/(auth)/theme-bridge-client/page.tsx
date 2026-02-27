import ThemeBridgeClient from "./theme-bridge-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default function ThemeBridgeClientPage() {
  return <ThemeBridgeClient />;
}

