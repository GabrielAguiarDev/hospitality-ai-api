import type { HistoryEntry } from './chat-intent.types.js';
import { SYSTEM_PROMPT, buildKnowledgePrompt, knowledgeHistory, polishReply } from './chat-prompts.js';

describe('knowledgeHistory', () => {
  const entry = (index: number, content = `mensagem ${index}`): HistoryEntry => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content,
  });

  it('returns an empty history untouched', () => {
    expect(knowledgeHistory([])).toEqual([]);
  });

  it('keeps short histories whole, in order', () => {
    const history = [entry(0), entry(1), entry(2)];

    expect(knowledgeHistory(history)).toEqual(history);
  });

  it('keeps only the last 6 entries', () => {
    const history = Array.from({ length: 12 }, (_, index) => entry(index));
    const result = knowledgeHistory(history);

    expect(result).toHaveLength(6);
    expect(result[0].content).toBe('mensagem 6');
    expect(result.at(-1)?.content).toBe('mensagem 11');
  });

  it('truncates each entry to 500 characters with an ellipsis, keeping the role', () => {
    const [truncated] = knowledgeHistory([{ role: 'assistant', content: 'a'.repeat(900) }]);

    expect(truncated.role).toBe('assistant');
    expect(truncated.content).toHaveLength(500);
    expect(truncated.content.endsWith('…')).toBe(true);
  });

  it('does not touch an entry of exactly 500 characters', () => {
    const content = 'b'.repeat(500);

    expect(knowledgeHistory([{ role: 'user', content }])[0].content).toBe(content);
  });

  it('does not mutate the original history', () => {
    const history = [{ role: 'user' as const, content: 'c'.repeat(900) }];

    knowledgeHistory(history);

    expect(history[0].content).toHaveLength(900);
  });
});

describe('polishReply', () => {
  it.each([
    ['Claro! O spa abre às 9h.', 'O spa abre às 9h.'],
    ['Olá! O spa abre às 9h.', 'O spa abre às 9h.'],
    ['Certamente, o spa abre às 9h.', 'O spa abre às 9h.'],
    ['Ótima pergunta! O spa abre às 9h.', 'O spa abre às 9h.'],
    ['Com certeza - o spa abre às 9h.', 'O spa abre às 9h.'],
    ['Oi, o spa abre às 9h.', 'O spa abre às 9h.'],
  ])('strips the opening filler of %j', (input, expected) => {
    expect(polishReply(input)).toBe(expected);
  });

  it.each([
    ['O spa abre às 9h. Espero ter ajudado!', 'O spa abre às 9h.'],
    ['O spa abre às 9h. Estou à disposição.', 'O spa abre às 9h.'],
    ['O spa abre às 9h. Fico à disposição!', 'O spa abre às 9h.'],
    ['O spa abre às 9h. Se precisar de mais alguma coisa, é só chamar.', 'O spa abre às 9h.'],
    ['O spa abre às 9h. Posso ajudar em mais alguma coisa?', 'O spa abre às 9h.'],
  ])('strips the closing filler of %j', (input, expected) => {
    expect(polishReply(input)).toBe(expected);
  });

  it.each([
    ['O spa abre às 9h. Quer que eu reserve um horário?', 'O spa abre às 9h.'],
    ['O spa abre às 9h! Gostaria de saber mais?', 'O spa abre às 9h!'],
    ['O spa abre às 9h. Posso ajudar com algo mais?', 'O spa abre às 9h.'],
    ['O spa abre às 9h. Que tipo de massagem você prefere?', 'O spa abre às 9h.'],
    ['O spa abre às 9h. Deseja agendar?', 'O spa abre às 9h.'],
  ])('strips a final offer question in %j', (input, expected) => {
    expect(polishReply(input)).toBe(expected);
  });

  it('keeps a reply that is only a question, and a question that is not an offer', () => {
    expect(polishReply('Quer que eu reserve um horário para você amanhã?')).toBe('Quer que eu reserve um horário para você amanhã?');
    expect(polishReply('O spa abre às 9h. Qual horário abre o spa?')).toContain('Qual horário abre o spa?');
  });

  it('strips both ends together', () => {
    expect(polishReply('Claro! O spa abre às 9h e fecha às 18h. Espero ter ajudado.')).toBe('O spa abre às 9h e fecha às 18h.');
  });

  it('neutralizes gendered forms of address', () => {
    expect(polishReply('Seja bem-vindo ao resort. O jantar é às 19h.')).toBe('Boas-vindas ao resort. O jantar é às 19h.');
    expect(polishReply('Seja bem-vinda! O jantar é às 19h.')).toBe('Boas-vindas! O jantar é às 19h.');
    expect(polishReply('O jantar é às 19h e o senhor pode reservar no app.')).toBe('O jantar é às 19h e você pode reservar no app.');
    expect(polishReply('A senhora pode reservar o jantar das 19h no app.')).toBe('Você pode reservar o jantar das 19h no app.');
    expect(polishReply('Prezado hóspede, o jantar é às 19h.')).toBe('O jantar é às 19h.');
    expect(polishReply('Caro hóspede, o jantar é às 19h.')).toBe('O jantar é às 19h.');
    expect(polishReply('O jantar é às 19h, querida!')).toBe('O jantar é às 19h!');
  });

  it('leaves a neutral, direct reply unchanged', () => {
    const reply = 'O jantar é servido das 19h às 22h, no restaurante principal.';

    expect(polishReply(reply)).toBe(reply);
  });

  it('keeps the original text when stripping would leave almost nothing', () => {
    expect(polishReply('Claro! Sim.')).toBe('Claro! Sim.');
  });

  it('trims whitespace and capitalizes the first letter', () => {
    expect(polishReply('   o spa abre às 9h.  ')).toBe('O spa abre às 9h.');
  });

  it('does not strip words that only start like a filler', () => {
    expect(polishReply('Claramente o spa abre às 9h.')).toBe('Claramente o spa abre às 9h.');
    expect(polishReply('Perfeito para famílias, o parque abre às 9h.')).toBe('Perfeito para famílias, o parque abre às 9h.');
  });

  it('handles an empty reply', () => {
    expect(polishReply('')).toBe('');
  });
});

describe('prompts', () => {
  it('asks for concise, neutral, plain-text answers', () => {
    expect(SYSTEM_PROMPT).toContain('Respostas curtas');
    expect(SYSTEM_PROMPT).toContain('Linguagem neutra');
    expect(SYSTEM_PROMPT).toContain('sem Markdown');
  });

  it('builds the knowledge prompt with documents inside the data block and the date', () => {
    const prompt = buildKnowledgePrompt(
      [{ id: 'doc-1', title: 'Spa', content: ' Abre às 9h. ', distance: 0.1 }],
      '2026-10-23',
    );

    expect(prompt).toContain('[Fonte: doc-1]');
    expect(prompt).toContain('Conteúdo: Abre às 9h.');
    expect(prompt).toContain('sexta-feira, 23/10/2026');
    expect(prompt.indexOf('Abre às 9h.')).toBeGreaterThan(prompt.indexOf('<contexto_do_resort>'));
  });

  it('says so when no document was found', () => {
    expect(buildKnowledgePrompt([], '2026-10-23')).toContain('Nenhum documento relevante foi encontrado.');
  });

  it('no longer carries a conversation prompt', async () => {
    const module = await import('./chat-prompts.js');

    expect(module).not.toHaveProperty('buildConversationPrompt');
  });
});
