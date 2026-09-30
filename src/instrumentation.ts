/** Runs once when the server starts. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { installDnsFallback } = await import("./server/dns-fallback");
    installDnsFallback();
    // When the agents trade on the market, their positions are watched for as long as the server runs.
    const { startRealWatch } = await import("./server/council/watch");
    startRealWatch();
  }
}
