import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'XZ 鲜知',
  description: '家庭食材、提醒与饮食管理',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/mascot/xiaozhi.png',
    apple: '/mascot/xiaozhi.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              window.addEventListener('error', function(e) {
                if (e.message && (e.message.indexOf('ChunkLoadError') !== -1 || e.message.indexOf('Loading chunk') !== -1)) {
                  console.warn('New deployment detected, reloading page to fetch latest JS chunks...');
                  window.location.reload();
                }
              });
            `,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
