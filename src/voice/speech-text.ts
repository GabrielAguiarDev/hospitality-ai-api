import { stripSymbols, toPlainText } from '../common/text.js';
import type { ChatAction } from '../contracts/chat-actions.js';

const LIST_ITEM = /^\s*(?:[-•*]|\d{1,2}[.)])\s+/;
const URL = /\bhttps?:\/\/\S+/gi;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
// Hashes e IDs técnicos longos (hexadecimais).
const HEX_ID = /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{16,}\b/gi;
// Linha de JSON: chaves/colchetes soltos, objeto ou lista de strings,
// ou "chave": valor JSON. "[Importante] …" e "Sunset Bar": aberto… ficam.
const STRUCTURED_LINE = /^\s*(?:[{}[\]]\s*,?\s*$|[{[]\s*"|"[^"]+"\s*:\s*(?:["{[\d-]|true\b|false\b|null\b))/;

// Ações exibidas como cartões; "navigate" é apenas um botão.
const hasCards = (actions: readonly ChatAction[] | null | undefined) =>
  (actions ?? []).some((action) => action.type !== 'navigate');

// Frases inteiras até o limite; uma frase maior é cortada na última palavra.
function limit(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;

  let result = '';
  for (const sentence of text.split(/(?<=[.!?…])\s+/)) {
    if (result.length + sentence.length + 1 > maxChars) break;
    result = result ? `${result} ${sentence}` : sentence;
  }

  return result || `${text.slice(0, maxChars).replace(/\s+\S*$/, '')}…`;
}

/**
 * Texto narrado de uma resposta do assistente: somente o conteúdo
 * conversacional. Remove Markdown, JSON, URLs e identificadores; com
 * cartões, os itens de lista (já representados nos cards) não são lidos,
 * e ficam a introdução e a conclusão. Nenhum dado é reescrito: apenas
 * trechos são omitidos e pontuação é acrescentada entre linhas.
 */
export function speechText(content: string, actions: readonly ChatAction[] | null | undefined, maxChars: number): string {
  const cards = hasCards(actions);

  const lines = toPlainText(content.replace(/```[\s\S]*?(?:```|$)/g, '\n'))
    .split('\n')
    .filter((line) => !STRUCTURED_LINE.test(line))
    .filter((line) => !(cards && LIST_ITEM.test(line)))
    .flatMap((line) => {
      const kept = line.replace(LIST_ITEM, '').replace(URL, '').replace(UUID, '').replace(HEX_ID, '');
      const spoken = stripSymbols(kept)
        .replace(/\(\s*\)|\[\s*\]/g, '')
        .replace(/\s+([.,;:!?])/g, '$1')
        .trim();
      // Rótulo que ficou vazio ("Link:", "ID:") após remover o identificador.
      const orphanLabel = kept !== line.replace(LIST_ITEM, '') && /^[^:]{0,30}:$/.test(spoken);

      return /\p{L}{2,}|\d/u.test(spoken) && !orphanLabel ? [spoken] : [];
    })
    // Pausa entre linhas: cada uma termina como frase.
    .map((line) => (/[.!?…;,]$/.test(line) ? line : `${line.replace(/:$/, '')}.`));

  return limit(lines.join(' ').replace(/\s+/g, ' ').trim(), maxChars);
}
