import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config, { isServer }) => {
    // Fix for @bsv/sdk trying to import react-native modules
    if (isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        'react-native-get-random-values': false,
      };
    }

    return config;
  },
};

export default nextConfig;
