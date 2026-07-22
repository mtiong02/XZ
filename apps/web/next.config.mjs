/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 开发服务使用 .next，生产构建使用 .next-build，避免两个进程互相覆盖 chunk。
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  // 统一用仓库根的 flat-config ESLint（pnpm lint / CI），不在 build 里跑 Next 自带的第二套
  eslint: { ignoreDuringBuilds: true },
  async rewrites() {
    // 管理端保持 /admin 这个对外地址；admin.html 只是 public 中的实现文件。
    return [{ source: '/admin', destination: '/admin.html' }];
  },
};

export default nextConfig;
