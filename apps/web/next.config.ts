import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // standalone é para a imagem Docker (compose/self-host): o build vira um
  // server.js autocontido. Na Vercel ele NÃO pode ficar ligado — o empacotador
  // dela (onBuildComplete) espera o layout padrão de traces e quebra com
  // "ENOENT: .next/next-server.js.nft.json". A env VERCEL=1 existe só lá.
  output: process.env.VERCEL ? undefined : "standalone",
};

export default nextConfig;
