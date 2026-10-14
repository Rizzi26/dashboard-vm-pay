/**
 * Texto de um CSV que o operador escolheu. O Excel em português salva "CSV"
 * em Windows-1252 e só o "CSV UTF-8" em UTF-8: tenta UTF-8 estrito primeiro;
 * se não for, é o do Windows — sem isso "Água" chega ao servidor como "�gua"
 * e nome de loja ou de produto não confere.
 */
export async function lerTextoDoArquivo(arquivo: File): Promise<string> {
  const bytes = await arquivo.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}
