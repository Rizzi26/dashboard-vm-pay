import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // standalone é para a imagem Docker (compose/self-host): o build vira um
  // server.js autocontido. Na Vercel ele NÃO pode ficar ligado — o empacotador
  // dela (onBuildComplete) espera o layout padrão de traces e quebra com
  // "ENOENT: .next/next-server.js.nft.json". A env VERCEL=1 existe só lá.
  output: process.env.VERCEL ? undefined : "standalone",
  experimental: {
    // Router Cache do browser: página dinâmica já visitada volta na hora por
    // até 3 min em vez de re-renderizar no servidor a cada troca de aba. O
    // dado muda 3×/dia (ingestão); ações locais chamam router.refresh(), que
    // invalida. Cache por usuário, no browser dele — nada compartilhado.
    staleTimes: { dynamic: 180 },
  },
};

export default nextConfig;

// deploy: força build da Vercel (skip-deployments ignora commits fora de apps/web)
