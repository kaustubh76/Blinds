import { lazy, Suspense } from "react";
import { Shell } from "./components/Shell";
import { Skeleton } from "./components/Skeleton";
import { useHashRoute } from "./lib/useHashRoute";

const Market = lazy(() => import("./features/market/Market").then((m) => ({ default: m.Market })));
const Explorer = lazy(() => import("./features/explorer/Explorer").then((m) => ({ default: m.Explorer })));
const Desk = lazy(() => import("./features/desk/Desk").then((m) => ({ default: m.Desk })));
const Positions = lazy(() => import("./features/positions/Positions").then((m) => ({ default: m.Positions })));

export function App() {
  const route = useHashRoute();
  return (
    <Shell tab={route.tab}>
      <Suspense
        fallback={
          <div className="grid gap-4">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        }
      >
        {route.tab === "market" && <Market />}
        {route.tab === "explorer" && <Explorer epochParam={route.param} />}
        {route.tab === "desk" && <Desk />}
        {route.tab === "positions" && <Positions />}
      </Suspense>
    </Shell>
  );
}
