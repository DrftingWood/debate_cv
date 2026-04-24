import type { NextConfig } from 'next';

const config: NextConfig = {
  serverExternalPackages: ['@prisma/client', 'googleapis'],
  experimental: {},
};

export default config;
