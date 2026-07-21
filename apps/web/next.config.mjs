/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 统一用仓库根的 flat-config ESLint（pnpm lint / CI），不在 build 里跑 Next 自带的第二套
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
