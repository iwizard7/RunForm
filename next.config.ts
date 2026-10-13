import type { NextConfig } from "next";
import path from "path";
import { createRequire } from "module";

const require_ = createRequire(import.meta.url);
const { version } = require_("./package.json") as { version: string };

const nextConfig: NextConfig = {
  env: {
    // The UI reads this, so the displayed version can never drift from
    // package.json.
    NEXT_PUBLIC_APP_VERSION: version,
  },
  images: {
    unoptimized: true,
  },
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
