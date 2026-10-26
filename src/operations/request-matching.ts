import { normalizeText } from '../common/text.js';
import type { RequestDepartment, RequestItem } from '../resort/requests-catalog.service.js';

/**
 * Correspondência determinística entre a mensagem e o catálogo de
 * Solicitações do snapshot. Só devolve itens e departamentos que existem
 * e estão ativos; nunca cria nomes a partir do texto.
 */

const STOPWORDS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'para', 'pra', 'com', 'a', 'o', 'as', 'os', 'e', 'em', 'no', 'na', 'nos', 'nas',
  'um', 'uma', 'uns', 'umas', 'mais', 'meu', 'minha', 'meus', 'minhas', 'quarto', 'por', 'favor', 'outros', 'outro',
  'como', 'podemos', 'te', 'ajudar', 'la', 'torre',
]);

const NUMBER_WORDS: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
};

// Sintomas de defeito sem item citado: o pedido é da Manutenção.
const MAINTENANCE_CUE =
  /\b(?:nao (?:funciona|liga|esquenta|gela|abre|fecha|tranca|acende)|nao (?:esta |ta )?(?:funcionando|ligando|esquentando|gelando|abrindo|fechando|trancando|acendendo)|quebrad[oa]s?|estragad[oa]s?|vazando|pingando|entupid[oa]s?|queimad[oa]s?|sem agua quente|com defeito|defeito|conserto|consertar|parou|travad[oa]s?)\b/;
const IT_CUE = /\b(?:internet|wifi|sem sinal|conexao)\b/;

// Singular aproximado: "toalhas" → "toalha", "lençóis" → "lencol".
export function stem(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith('oes') || word.endsWith('aes')) return `${word.slice(0, -3)}ao`;
  if (word.endsWith('ois')) return `${word.slice(0, -3)}ol`;
  if (word.endsWith('ais')) return `${word.slice(0, -3)}al`;
  if (word.endsWith('eis')) return `${word.slice(0, -3)}el`;
  if (word.endsWith('res') || word.endsWith('zes')) return word.slice(0, -2);
  if (word.endsWith('ns')) return `${word.slice(0, -2)}m`;
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

export function requestTokens(value: string): string[] {
  return normalizeText(value)
    .replace(/\bwi fi\b/g, 'wifi')
    .split(' ')
    .filter((word) => word.length >= 2 && !STOPWORDS.has(word) && !/^\d+$/.test(word))
    .map(stem);
}

/** Departamento citado pelo nome ("governança", "manutenção", "TI"). */
export function mentionedDepartment(message: string, departments: RequestDepartment[]): RequestDepartment | undefined {
  const text = ` ${normalizeText(message)} `;

  return departments.find((department) => {
    const name = normalizeText(department.name);
    const first = name.split(' ')[0];
    return text.includes(` ${name} `) || (first.length >= 5 && text.includes(` ${first} `));
  });
}

export function symptomDepartment(message: string, departments: RequestDepartment[]): RequestDepartment | undefined {
  const text = normalizeText(message).replace(/\bwi fi\b/g, 'wifi');
  const byName = (pattern: RegExp) => departments.find(({ name }) => pattern.test(normalizeText(name)));
  if (IT_CUE.test(text)) return byName(/^ti$/);
  if (MAINTENANCE_CUE.test(text)) return byName(/^manutencao$/);
  return undefined;
}

export interface MatchedItem {
  department: RequestDepartment;
  item: RequestItem;
  quantity: number;
  // Empatado com outro item pelas mesmas palavras: o handler pergunta qual.
  tied: boolean;
}

/**
 * Quantidade junto do item: em "2 toalhas de banho e 1 toalha de rosto",
 * vale o número cuja sequência cobre mais palavras do nome do item.
 */
function quantityFor(message: string, itemTokens: string[]): number {
  const words = normalizeText(message).split(' ');
  let best = { coverage: 0, value: 1 };

  for (let index = 1; index < words.length; index += 1) {
    if (!itemTokens.includes(stem(words[index]))) continue;
    // "2 toalhas", "duas toalhas", "mais 2 toalhas de banho".
    const previous = words[index - 1];
    const value = /^\d{1,2}$/.test(previous) ? Number(previous) : NUMBER_WORDS[previous];
    if (value === undefined) continue;

    const span = words.slice(index, index + 4).map(stem);
    const coverage = itemTokens.filter((token) => span.includes(token)).length;
    if (coverage > best.coverage) best = { coverage, value: Math.min(Math.max(value, 1), 10) };
  }

  return best.value;
}

/**
 * Itens do catálogo citados na mensagem. Para cada palavra, o item de
 * melhor cobertura vence ("TV" sozinha → item "TV", não "Canais de TV").
 * Itens empatados de departamentos diferentes voltam todos, para o
 * handler perguntar qual.
 */
export function matchItems(message: string, departments: RequestDepartment[]): MatchedItem[] {
  const words = new Set(requestTokens(message));
  const scored = departments.flatMap((department) =>
    department.items.map((item) => {
      const tokens = [...new Set(requestTokens(item.name))];
      const hits = tokens.filter((token) => words.has(token));
      return { department, item, tokens, hits, score: hits.length + (tokens.length ? hits.length / tokens.length : 0) };
    }),
  ).filter(({ hits }) => hits.length > 0);

  const chosen: (typeof scored[number] & { tied: boolean })[] = [];
  const covered = new Set<string>();

  for (const candidate of [...scored].sort((a, b) => b.score - a.score)) {
    if (candidate.hits.every((token) => covered.has(token))) {
      // Empate exato com um item já escolhido (mesmas palavras): também é candidato.
      const tie = chosen.find((item) => item.score === candidate.score && item.hits.join() === candidate.hits.join());
      if (!tie) continue;
      tie.tied = true;
      chosen.push({ ...candidate, tied: true });
      continue;
    }
    chosen.push({ ...candidate, tied: false });
    candidate.hits.forEach((token) => covered.add(token));
  }

  return chosen.map(({ department, item, tokens, tied }) => ({ department, item, quantity: quantityFor(message, tokens), tied }));
}
