/** The top-bar strip: the benchmark, the reference price, and the window phase — all from polls. */
import { useDeployment, useOracle, usePrice } from "./queries";
import { useWindowClock } from "./useWindowClock";

export function useTicker() {
  const dep = useDeployment();
  const oracle = useOracle();
  const price = usePrice(dep.data?.feedId);
  const clock = useWindowClock();
  const o = oracle.data;
  return {
    xonia: o?.hasPrinted && o.lastRStarTick !== 255 ? o.lastRStarTick : null,
    xoniaEpoch: o?.hasPrinted ? o.lastPrintEpoch : null,
    stale: !!o?.stale,
    tau: o?.tau ?? 0,
    price: price.data ? { price: price.data.price, expo: price.data.expo, publishTime: price.data.publishTime } : null,
    clock,
    cluster: dep.data?.raw.cluster ?? "devnet",
  };
}
