import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // xrpl.js and the Privy server SDK use Node APIs (ws, crypto); keep them out of the bundle.
  serverExternalPackages: ["xrpl", "@privy-io/node"],
  // The Privy app ID is public; expose it to the browser without a second env var.
  env: { NEXT_PUBLIC_PRIVY_APP_ID: process.env.PRIVY_APP_ID },
};

export default nextConfig;
