import { toPlainText } from './text.js';

describe('toPlainText', () => {
  it('removes Markdown emphasis, headings and code fences', () => {
    expect(toPlainText('## Dica\n**Leve** protetor e __chapéu__.\n```\nok\n```')).toBe('Dica\nLeve protetor e chapéu.\nok');
  });

  it('keeps underscores inside words', () => {
    expect(toPlainText('Arquivo roteiro__v2__final e snake_case.')).toBe('Arquivo roteiro__v2__final e snake_case.');
  });
});
