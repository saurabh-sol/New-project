/** Runs once when the server starts. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { installDnsFallback } = await import("./server/dns-fallback");
    installDnsFallback();
  }
}
