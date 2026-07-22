/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 开发服务使用 .next，生产构建使用 .next-build，避免两个进程互相覆盖 chunk。
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  // 统一用仓库根的 flat-config ESLint（pnpm lint / CI），不在 build 里跑 Next 自带的第二套
  eslint: { ignoreDuringBuilds: true },
  async redirects() {
    return [{ source: '/admin', destination: '/admin.html', permanent: false }];
  },
};

export default nextConfig;
