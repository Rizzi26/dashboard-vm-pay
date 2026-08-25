import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // standalone: o build vira um server.js autocontido, que é o que a imagem
  // Docker roda. A Vercel ignora isto e faz o build dela normalmente.
  output: "standalone",
};

export default nextConfig;
