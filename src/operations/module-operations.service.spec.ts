import type { IntentDecision, ModuleIntent } from '../chat/chat-intent.types.js';
import { isValidChatAction } from '../contracts/chat-actions.js';
import type { GuestContext } from '../guest/guest-context.js';
import type { BoutiqueProduct, EsgInfo, QuizInfo, SpaService, Tip } from '../resort/modules-catalog.service.js';

import { ModuleOperationsService } from './module-operations.service.js';
import type { OperationsToolRegistryService } from './operations-tool-registry.service.js';

const GUEST: GuestContext = { resortId: 'demo', guestId: '0a0b0c0d-1111-4222-8333-444455556666' };

const PRODUCTS: BoutiqueProduct[] = [
  { id: '1', name: 'Protetor solar FPS 50', category: 'Praia', price: 59.9 },
  { id: '2', name: 'Chapéu de palha', category: 'Praia', price: 45 },
  { id: '3', name: 'Camiseta Yaayoo', category: 'Vestuário', price: null },
  { id: '4', name: 'Canga estampada', category: 'Praia', price: 80 },
];

const SERVICES: SpaService[] = [
  { id: '1', name: 'Massagem Relaxante', category: 'Massagens', price: null, details: '50 min R$ 250,00; 30 min R$ 180,00' },
  { id: '2', name: 'Drenagem Linfática', category: 'Massagens', price: 200, details: '60 min' },
  { id: '3', name: 'Manicure', category: 'Salão', price: null, details: null },
  { id: '4', name: 'Massagem Relaxante', category: 'Stand da praia', price: 120, details: '30 min' },
];

const TIPS: Tip[] = [
  { id: '1', title: 'Águas-vivas', description: 'Evite tocar; lave com água do mar, nunca com água doce.' },
  { id: '2', title: 'Henna', description: null },
  { id: '3', title: 'Pertences na praia', description: 'Não deixe objetos sem vigilância.' },
];

const QUIZZES: QuizInfo[] = [{ id: '1', title: 'Quiz do Mar', theme: 'Natureza', mode: 'live', questions: 10 }];

const ESG: EsgInfo[] = [{ title: 'ESG', description: 'O resort separa resíduos, usa energia solar e protege a restinga.' }];

describe('ModuleOperationsService', () => {
  let data: {
    'boutique.list': BoutiqueProduct[];
    'spa.list': SpaService[];
    'tips.list': Tip[];
    'quiz.list': QuizInfo[];
    'esg.info': EsgInfo[];
  };
  const execute = vi.fn(async (name: string, _guest: GuestContext, _input?: unknown) => ({
    tool: name,
    data: data[name as keyof typeof data],
  }));
  const service = new ModuleOperationsService({ execute } as unknown as OperationsToolRegistryService);

  beforeEach(() => {
    data = { 'boutique.list': PRODUCTS, 'spa.list': SERVICES, 'tips.list': TIPS, 'quiz.list': QUIZZES, 'esg.info': ESG };
    execute.mockClear();
  });

  // Intl usa espaço sem quebra entre "R$" e o valor; os textos esperados usam espaço comum.
  const plain = <T extends { reply: string }>(result: T): T => ({ ...result, reply: result.reply.replaceAll('\u00a0', ' ') });

  const ask = async (message: string, intent: ModuleIntent, state = {}) =>
    plain(await service.handle(message, { intent, detail: 'none' } as IntentDecision & { intent: ModuleIntent }, GUEST, { conversationId: 'c', state }));

  const noList = (reply: string) => expect(reply).not.toMatch(/^\s*(?:\d+\.|-)\s/m);

  const screenOf = (result: { actions?: unknown[] }) =>
    (result.actions as { type: string; screen: string }[]).find(({ type }) => type === 'navigate')?.screen;

  describe('boutique', () => {
    it('summarizes the shop and offers the Boutique screen', async () => {
      const result = await ask('Quais produtos tem na boutique?', 'boutique.info');

      expect(result.tool).toBe('boutique.list');
      expect(result.reply).toBe('A Boutique tem 4 produtos em Praia e Vestuário.');
      expect(screenOf(result)).toBe('Boutique');
      expect(result.actions?.every(isValidChatAction)).toBe(true);
      expect(result.state?.topic).toBe('module');
      noList(result.reply);
    });

    it('lists a category by name', async () => {
      const result = await ask('O que tem na categoria Praia?', 'boutique.info');

      expect(result.reply).toMatch(/^Praia tem 3 produtos, como /);
      expect(result.reply).toContain('Protetor solar FPS 50');
      expect(result.reply).not.toContain('Camiseta');
    });

    it('answers a product by name with its price', async () => {
      const result = await ask('Quanto custa o protetor solar?', 'boutique.info');

      expect(result.reply).toBe('Protetor solar FPS 50: R$ 59,90. Disponível na Boutique.');
      expect(result.resultCount).toBe(1);
    });

    it('says the price is not registered instead of inventing one', async () => {
      const result = await ask('Quanto custa a camiseta?', 'boutique.info');

      expect(result.reply).toContain('Camiseta Yaayoo: preço não cadastrado');
      expect(result.reply).not.toContain('R$');
    });

    it('says it did not find a missing product and never claims it exists', async () => {
      const result = await ask('Vocês vendem guarda-chuva na boutique?', 'boutique.info');

      expect(result.reply).toMatch(/^Não encontrei esse produto no cadastro da Boutique\./);
      expect(result.reply).not.toMatch(/guarda/i);
      expect(screenOf(result)).toBe('Boutique');
    });

    it('does not claim a missing product for a generic question', async () => {
      const result = await ask('O que a boutique vende?', 'boutique.info');

      expect(result.reply).not.toContain('Não encontrei');
    });

    it('handles an empty catalog without crashing', async () => {
      data['boutique.list'] = [];

      const result = await ask('Quais produtos tem na boutique?', 'boutique.info');

      expect(result.reply).toContain('0 produtos');
      expect(result.resultCount).toBe(0);
    });
  });

  describe('findProducts (RAG fallback)', () => {
    it('returns a Boutique answer for a product cited by name', async () => {
      const found = await service.findProducts('Vocês têm protetor solar?', GUEST, { conversationId: 'c', state: { topic: 'knowledge' } });
      const result = found && plain(found);

      expect(result?.reply).toBe('Na Boutique: Protetor solar FPS 50, R$ 59,90.');
      expect(result?.tool).toBe('boutique.list');
      expect(screenOf(result ?? {})).toBe('Boutique');
    });

    it('returns null when nothing matches, so the generic fallback is used', async () => {
      await expect(service.findProducts('Vocês têm heliponto?', GUEST)).resolves.toBeNull();
      await expect(service.findProducts('Olá', GUEST)).resolves.toBeNull();
    });

    it('returns null for generic words only', async () => {
      await expect(service.findProducts('Quais produtos vocês vendem?', GUEST)).resolves.toBeNull();
      await expect(service.findProducts('', GUEST)).resolves.toBeNull();
    });

    it('cites at most 3 products', async () => {
      data['boutique.list'] = [1, 2, 3, 4, 5].map((index) => ({ id: `${index}`, name: `Chinelo ${index}`, category: 'Praia', price: 30 }));

      const result = await service.findProducts('Tem chinelo?', GUEST);

      expect(result?.resultCount).toBe(3);
    });

    it('does not match a product on a single weak word of its name', async () => {
      data['boutique.list'] = [{ id: '9', name: 'Boia de piscina inflável', category: 'Praia', price: 30 }];

      // "piscina" é 1 de 3 palavras do nome: uma pergunta de horário não vira produto.
      await expect(service.findProducts('Que horas abre a piscina?', GUEST)).resolves.toBeNull();
      await expect(service.findProducts('A piscina é aquecida?', GUEST)).resolves.toBeNull();
    });

    it('matches when at least 2 name words or half of them are cited', async () => {
      data['boutique.list'] = [{ id: '9', name: 'Boia de piscina inflável', category: 'Praia', price: 30 }];

      await expect(service.findProducts('Tem boia de piscina?', GUEST)).resolves.toMatchObject({ resultCount: 1 });
      await expect(service.findProducts('Tem boia?', GUEST)).resolves.toBeNull();
    });

    it('never reads other tools', async () => {
      await service.findProducts('Tem protetor solar?', GUEST);

      expect(execute.mock.calls.map(([name]) => name)).toEqual(['boutique.list']);
    });
  });

  describe('spa', () => {
    it('never shows "R$ 0": a service with no price column uses its text details', async () => {
      const result = await ask('Quanto custa a massagem relaxante?', 'spa.info');

      expect(result.reply).not.toMatch(/R\$\s*0(?:[,.]00)?(?!\d)/);
      expect(result.reply).toContain('50 min R$ 250,00; 30 min R$ 180,00');
    });

    // Defesa em profundidade: o catálogo já troca 0 por null (ver modules-catalog.service.spec.ts),
    // mas o handler também não deveria exibir "R$ 0,00" se um preço 0 chegasse até ele.
    it('does not print "R$ 0,00" if a zero price ever reaches the handler', async () => {
      data['spa.list'] = [{ id: '1', name: 'Massagem Relaxante', category: 'Massagens', price: 0, details: '50 min R$ 250,00' }];

      const result = await ask('Quanto custa a massagem relaxante?', 'spa.info');

      expect(result.reply).not.toMatch(/R\$\s*0,00/);
    });

    it('says "valor não cadastrado" when neither price nor details exist', async () => {
      const result = await ask('Quanto custa a manicure?', 'spa.info');

      expect(result.reply).toContain('Manicure: valor não cadastrado');
      expect(result.reply).not.toContain('R$ 0');
    });

    it('combines the registered price with the duration', async () => {
      const result = await ask('Quanto custa a drenagem linfática?', 'spa.info');

      expect(result.reply).toContain('Drenagem Linfática: R$ 200,00, 60 min');
    });

    it('names the place when the same service exists in two categories', async () => {
      const result = await ask('Quanto custa a massagem relaxante?', 'spa.info');

      expect(result.reply).toContain('Massagem Relaxante (Massagens)');
      expect(result.reply).toContain('Massagem Relaxante (Stand da praia)');
    });

    it('lists a category on "Quais massagens tem?"', async () => {
      const result = await ask('Quais massagens tem?', 'spa.info');

      expect(result.reply).toMatch(/^Massagens: /);
      expect(result.reply).toContain('Drenagem Linfática');
      expect(result.reply).not.toContain('Manicure');
      expect(result.reply).toContain('O agendamento é feito pelo SPA.');
      noList(result.reply);
    });

    it('summarizes the menu without a specific term and points to the SPA for booking', async () => {
      const result = await ask('O que o spa oferece?', 'spa.info');

      expect(result.reply).toBe('O SPA oferece 4 serviços em Massagens, Salão e Stand da praia. O agendamento é feito pelo SPA.');
      expect(screenOf(result)).toBe('Spa');
    });
  });

  describe('quiz', () => {
    it('describes the active quiz and sends the guest to the Quiz screen', async () => {
      const result = await ask('Tem quiz hoje?', 'quiz.info');

      expect(result.reply).toBe('Quiz ativo: Quiz do Mar (Natureza). A participação é pela tela de Quiz.');
      expect(screenOf(result)).toBe('Quiz');
    });

    it('says there is no active quiz', async () => {
      data['quiz.list'] = [];

      const result = await ask('Tem quiz hoje?', 'quiz.info');

      expect(result.reply).toBe('Não há quiz ativo no momento. Quando houver, ele aparece na tela de Quiz.');
      expect(result.resultCount).toBe(0);
    });
  });

  describe('esg', () => {
    it('answers with the published text', async () => {
      const result = await ask('O que vocês fazem de ESG?', 'esg.info');

      expect(result.reply).toBe('O resort separa resíduos, usa energia solar e protege a restinga. As iniciativas estão na tela de ESG.');
      expect(screenOf(result)).toBe('Esg');
    });

    it('does not invent initiatives when no text is published', async () => {
      data['esg.info'] = [];

      const result = await ask('O que vocês fazem de ESG?', 'esg.info');

      expect(result.reply).toBe('As iniciativas de ESG do resort estão na tela de ESG.');
      expect(result.resultCount).toBe(0);
    });
  });

  describe('tips', () => {
    it('details the tip for the subject asked', async () => {
      const result = await ask('dicas sobre águas-vivas', 'tips.list');

      expect(result.reply).toBe('Águas-vivas: Evite tocar; lave com água do mar, nunca com água doce.');
      expect(screenOf(result)).toBe('Tips');
    });

    it('points to the screen when the tip has no description', async () => {
      const result = await ask('dicas sobre henna', 'tips.list');

      expect(result.reply).toBe('Henna: veja os detalhes na tela de Dicas.');
    });

    it('lists up to 3 titles when no subject is given', async () => {
      const result = await ask('Quais dicas vocês têm?', 'tips.list');

      expect(result.reply).toBe('Separei 3 dicas para a estadia: Águas-vivas, Henna e Pertences na praia. Diga o assunto para eu detalhar.');
    });

    it('says there are no tips', async () => {
      data['tips.list'] = [];

      const result = await ask('Quais dicas vocês têm?', 'tips.list');

      expect(result.reply).toBe('Não há dicas publicadas no momento.');
    });
  });

  it('preserves the rest of the conversation state and only sets the module topic', async () => {
    const result = await ask('Tem quiz hoje?', 'quiz.info', { phase: 'completed', event: { date: '2026-10-24' } });

    expect(result.state).toEqual({ phase: 'completed', event: { date: '2026-10-24' }, topic: 'module' });
  });

  it('calls only the tool of the intent, with an empty input', async () => {
    await ask('Tem quiz hoje?', 'quiz.info');

    expect(execute).toHaveBeenCalledExactlyOnceWith('quiz.list', GUEST, {});
  });

  it('rejects a mismatched tool result', async () => {
    execute.mockResolvedValueOnce({ tool: 'spa.list', data: [] } as never);

    await expect(ask('Tem quiz hoje?', 'quiz.info')).rejects.toThrow('Resultado inesperado da ferramenta.');
  });

  it('keeps every reply short: at most 3 sentences and no line breaks', async () => {
    const replies = await Promise.all([
      ask('Quais produtos tem na boutique?', 'boutique.info'),
      ask('Quais massagens tem?', 'spa.info'),
      ask('Tem quiz hoje?', 'quiz.info'),
      ask('Quais dicas vocês têm?', 'tips.list'),
      ask('O que vocês fazem de ESG?', 'esg.info'),
    ]);

    for (const { reply } of replies) {
      expect(reply).not.toContain('\n');
      expect(reply.split(/(?<=[.!?])\s+/).length, reply).toBeLessThanOrEqual(3);
    }
  });
});
