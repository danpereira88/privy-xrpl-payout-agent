import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the Privy server SDK external. xrpl must be bundled: its dependency @xrplf/isomorphic is CJS but
  // require()s the ESM-only @noble/hashes v2, which crashes on Vercel's Node runtime (ERR_REQUIRE_ESM).
  serverExternalPackages: ["@privy-io/node"],
  // The Privy app ID is public; expose it to the browser without a second env var.
  env: { NEXT_PUBLIC_PRIVY_APP_ID: process.env.PRIVY_APP_ID },
};

export default nextConfig;
