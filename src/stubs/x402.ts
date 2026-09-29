/**
 * Stand-in for the optional @x402/* payment packages.
 *
 * RainbowKit pulls in Coinbase's SDK, which can sign "x402" payments using these
 * packages. This app never does that, and the packages are not installed, so the
 * bundler is pointed here instead. Anything that tried to use them would fail loudly.
 */
const unavailable = (name: string) => () => {
  throw new Error(`${name} needs the @x402 packages, which this app does not install.`);
};

export const x402Client = unavailable("x402Client");
export const registerExactEvmScheme = unavailable("registerExactEvmScheme");
export const toClientEvmSigner = unavailable("toClientEvmSigner");

export class UptoEvmScheme {
  constructor() {
    unavailable("UptoEvmScheme")();
  }
}

export class ExactSvmScheme {
  constructor() {
    unavailable("ExactSvmScheme")();
  }
}
