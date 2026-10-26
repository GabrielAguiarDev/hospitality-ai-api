import { normalizeText } from '../../common/text.js';

import { detectModule } from './modules.js';

const detect = (message: string) => detectModule(normalizeText(message));

describe('detectModule', () => {
  it.each([
    ['Quais produtos tem na boutique?', 'boutique.info'],
    ['Tem lojinha aqui?', 'boutique.info'],
    ['Quanto custa a massagem relaxante?', 'spa.info'],
    ['Quais massagens tem?', 'spa.info'],
    ['Spa', 'spa.info'],
    ['Tem quiz hoje?', 'quiz.info'],
    ['dicas sobre águas-vivas', 'tips.list'],
    ['Quais dicas vocês têm?', 'tips.list'],
    ['O que vocês fazem de ESG?', 'esg.info'],
    ['Como é a sustentabilidade do resort?', 'esg.info'],
  ])('routes "%s" to %s', (message, intent) => {
    expect(detect(message)).toBe(intent);
  });

  it.each([
    'Que horas abre o spa?',
    'Qual o horário da boutique?',
    'Onde fica o spa?',
    'Como faço para agendar uma massagem?',
    'Quero marcar uma drenagem',
    'Qual a senha do wifi?',
    'Qual o horário da área de lazer?',
    'Obrigado!',
  ])('leaves "%s" to the knowledge base or another detector', (message) => {
    expect(detect(message)).toBeNull();
  });

  it('never claims messages about other domains', () => {
    expect(detect('Quais experiências têm no spa?')).toBeNull();
    expect(detect('Quero reservar o restaurante da boutique')).toBeNull();
    expect(detect('Solicitação de produtos para o quarto')).toBeNull();
  });

  it('does not take restaurant or experience tips as the Tips module', () => {
    expect(detect('dicas de restaurante')).toBeNull();
    expect(detect('dicas de passeio')).toBeNull();
  });

  it('does not match a module word embedded in a longer word', () => {
    expect(detect('espanhol')).toBeNull();
    expect(detect('despachar')).toBeNull();
  });
});
