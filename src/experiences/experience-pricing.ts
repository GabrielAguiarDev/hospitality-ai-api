import { normalizeText } from '../common/text.js';

import type {
  ExperienceInfo,
  PartyComposition,
  PriceQuote,
} from './experience.types.js';

type PriceKind = 'adult' | 'child' | 'child_free' | 'package';

function kindOf(category: string): PriceKind {
  const normalized = normalizeText(category);

  if (normalized === 'adulto') {
    return 'adult';
  }

  if (normalized.startsWith('crianca')) {
    return normalized.includes('free') || normalized.includes('gratis')
      ? 'child_free'
      : 'child';
  }

  return 'package';
}

const toCents = (value: number): number => Math.round(value * 100);

/**
 * Calcula o valor no backend a partir das tarifas cadastradas.
 *
 * Regra verificada no snapshot: reservas pagas somam
 * adultos × tarifa "Adulto" + crianças × tarifa "Criança".
 * Quando a regra não pode ser aplicada com segurança,
 * o total é null e a observação explica o motivo.
 */
export function quoteExperience(
  experience: Pick<ExperienceInfo, 'reservationType' | 'prices'>,
  party: PartyComposition,
): PriceQuote {
  const quote: PriceQuote = {
    currency: 'BRL',
    total: null,
    adultUnit: null,
    childUnit: null,
    included: false,
    note: null,
  };

  if (experience.reservationType === 'allinclusive') {
    return {
      ...quote,
      total: 0,
      included: true,
      note: 'Experiência do tipo all inclusive, sem cobrança cadastrada.',
    };
  }

  if (experience.reservationType !== 'reserva') {
    return { ...quote, note: 'Tipo de cobrança não cadastrado.' };
  }

  const byKind = (kind: PriceKind) =>
    experience.prices.filter((price) => kindOf(price.category) === kind);

  const adult = byKind('adult');
  const child = byKind('child');
  const childFree = byKind('child_free');
  const packages = byKind('package');

  quote.adultUnit = adult.length === 1 ? adult[0].price : null;

  if (child.length === 1 && childFree.length === 0) {
    quote.childUnit = child[0].price;
  } else if (child.length === 0 && childFree.length === 1) {
    quote.childUnit = childFree[0].price;
  }

  if (party.adults > 0 && quote.adultUnit === null) {
    return {
      ...quote,
      note: packages.length
        ? `Tarifa por pacote (${packages.map((p) => p.category).join(', ')}); cálculo automático indisponível.`
        : 'Valor para adultos não cadastrado.',
    };
  }

  if (party.children > 0 && quote.childUnit === null) {
    return {
      ...quote,
      note:
        child.length && childFree.length
          ? 'O valor para crianças depende da faixa etária (há tarifa gratuita e tarifa paga cadastradas), que não consta no sistema.'
          : 'Valor para crianças não cadastrado.',
    };
  }

  const totalCents =
    party.adults * toCents(quote.adultUnit ?? 0) +
    party.children * toCents(quote.childUnit ?? 0);

  return { ...quote, total: totalCents / 100 };
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}
