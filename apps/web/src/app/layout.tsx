import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

// Geist só entra fora da Apple: a pilha em globals.css pede SF primeiro.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "VMpay · Vendas",
  description: "Dashboard de vendas das máquinas VMpay",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // cover: o fundo vai até a borda do iPhone; quem respeita a safe-area é a
  // barra de abas e o topo (env(safe-area-inset-*)).
  viewportFit: "cover",
  colorScheme: "light dark",
  // Mesmo valor de --fundo-liso nos dois temas: a barra do navegador emenda
  // com a página.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F2F2F7" },
    { media: "(prefers-color-scheme: dark)", color: "#0B0B0F" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
