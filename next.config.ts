import type { NextConfig } from "next";

// See src/stubs/x402.ts for why these are replaced.
const X402_STUB = "./src/stubs/x402.ts";

const nextConfig: NextConfig = {
  turbopack: {
    resolveAlias: {
      "@x402/core/client": X402_STUB,
      "@x402/evm": X402_STUB,
      "@x402/evm/exact/client": X402_STUB,
      "@x402/evm/upto/client": X402_STUB,
      "@x402/svm/exact/client": X402_STUB,
    },
  },
};

export default nextConfig;
