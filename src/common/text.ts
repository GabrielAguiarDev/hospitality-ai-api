// Normaliza texto para comparações: sem acentos, emojis ou pontuação.
export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function textTokens(value: string): string[] {
  const normalized = normalizeText(value);
  return normalized ? normalized.split(' ') : [];
}

// Remove espaços repetidos e quebras de linha de textos do snapshot.
export function compactText(value: string | null | undefined, maxLength = 1200): string {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
}

export interface NamedCandidate {
  id: string;
  name: string;
}

const GENERIC_NAME_TOKENS = new Set([
  'a',
  'o',
  'as',
  'os',
  'de',
  'da',
  'do',
  'das',
  'dos',
  'e',
  'em',
  'no',
  'na',
  'restaurante',
  'bar',
  'gastronomia',
  'experiencia',
  'passeio',
  'reserva',
  'reservas',
  'anos',
  'min',
  'partir',
  'ate',
  'kg',
]);

export function significantTokens(name: string): string[] {
  return textTokens(name).filter(
    (token) => token.length >= 3 && !GENERIC_NAME_TOKENS.has(token) && !/^\d+$/.test(token),
  );
}

/**
 * Localiza candidatos citados na mensagem pelo nome.
 * Retorna todos os empatados com a maior pontuação, para que
 * o chamador peça esclarecimento em vez de escolher arbitrariamente.
 */
export function matchByName<T extends NamedCandidate>(
  message: string,
  candidates: readonly T[],
): T[] {
  const messageTokens = new Set(textTokens(message));

  const scored = candidates
    .map((candidate) => {
      const tokens = significantTokens(candidate.name);
      const hits = tokens.filter((token) => messageTokens.has(token)).length;

      return {
        candidate,
        hits,
        ratio: tokens.length ? hits / tokens.length : 0,
      };
    })
    .filter((item) => item.hits > 0);

  if (scored.length === 0) {
    return [];
  }

  const best = Math.max(...scored.map((item) => item.hits * 10 + item.ratio));

  return scored
    .filter((item) => item.hits * 10 + item.ratio === best)
    .map((item) => item.candidate);
}

// Normaliza horários do snapshot ("19:00", "9h", "10h30") para HH:MM.
export function normalizeTime(value: string | null | undefined): string | null {
  const match = value?.trim().match(/^(\d{1,2})\s*[:hH]\s*(\d{2})?/);

  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2] ?? '0');

  if (hours > 23 || minutes > 59) {
    return null;
  }

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

// Remove emojis e bandeiras de textos cadastrados ("Omakase🇯🇵").
export function stripSymbols(value: string): string {
  return value
    .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\u{FE0F}\u{200D}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resumo de uma descrição cadastrada: frases inteiras até `maxLength`,
 * sem emojis nem listas de preços (os valores vêm de campos próprios).
 */
export function summarizeText(value: string | null | undefined, maxLength = 220): string {
  const sentences = stripSymbols(compactText(value, 4000))
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => sentence && !/R\$|\bvalores?\s*:/i.test(sentence));

  let summary = '';

  for (const sentence of sentences) {
    if (summary && summary.length + sentence.length + 1 > maxLength) break;
    summary = summary ? `${summary} ${sentence}` : sentence;
  }

  return summary.length > maxLength ? `${summary.slice(0, maxLength - 1).trimEnd()}…` : summary;
}

/**
 * Texto simples para o aplicativo, que não renderiza Markdown:
 * remove negrito, títulos, código e links gerados pelo modelo.
 */
export function toPlainText(value: string): string {
  return value
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(^|[\s(])__(\S(?:[^\n]*?\S)?)__(?=[\s).,!?:;]|$)/gm, '$1$2')
    .replace(/(^|[\s(])\*(\S(?:[^*\n]*\S)?)\*(?=[\s).,!?:;]|$)/g, '$1$2')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^(\s*)[*+]\s+/gm, '$1- ')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, '$1')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Citação breve de nomes no texto ("A, B e C", "A, B, C e mais 4"):
 * os detalhes ficam nos cards.
 */
export function nameList(names: string[], max = 3): string {
  if (names.length <= max) {
    return names.length > 1 ? `${names.slice(0, -1).join(', ')} e ${names.at(-1)}` : (names[0] ?? '');
  }
  return `${names.slice(0, max).join(', ')} e mais ${names.length - max}`;
}
