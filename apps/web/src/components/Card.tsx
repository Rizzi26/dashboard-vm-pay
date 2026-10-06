import { Cartao } from "@/components/ui/Cartao";

/**
 * API antiga, visual novo: as telas que ainda usam Card já saem em vidro.
 * Tela nova usa Cartao direto (título opcional, ações, compacto).
 */
export function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <Cartao titulo={title} subtitulo={subtitle}>
      {children}
    </Cartao>
  );
}
