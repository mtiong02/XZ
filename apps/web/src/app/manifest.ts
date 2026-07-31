import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'XZ 鲜知',
    short_name: 'XZ',
    description: 'AI 数字冰箱与家庭饮食数据平台',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#16a34a',
    icons: [
      {
        src: '/mascot/xiaozhi-icon.png',
        sizes: '192x192',
        type: 'image/png',
      },
    ],
  };
}
