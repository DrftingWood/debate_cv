import type { MetadataRoute } from 'next';
import { getSiteUrl } from '@/lib/utils/site';

export default function robots(): MetadataRoute.Robots {
  const base = getSiteUrl();
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/privacy', '/terms'],
        disallow: ['/dashboard', '/cv', '/api/'],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
