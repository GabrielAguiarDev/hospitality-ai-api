import { normalizeText } from '../../common/text.js';
import type { ConversationState } from '../../contracts/conversation-state.js';

import { detectCatalogFollowUp, detectFavorites, detectLeisureEnrollment, detectMenu } from './personal.js';

const t = normalizeText;

describe('personal and catalog detectors', () => {
  it.each([
    ['Mostre meus favoritos', 'favorite.list'],
    ['Quais são os meus favoritos?', 'favorite.list'],
    ['Adicione essa experiência aos favoritos', 'favorite.manage'],
    ['Tira o show dos favoritos', 'favorite.manage'],
    ['Quero favoritar o show de hoje', 'favorite.manage'],
    ['Quais restaurantes vocês têm?', null],
  ])('detectFavorites(%j) → %s', (message, expected) => {
    expect(detectFavorites(t(message))).toBe(expected);
  });

  it.each([
    ['Quero inscrever meu filho na recreação', 'leisure.enroll'],
    ['Quero participar dessa atividade', 'leisure.enroll'],
    ['Como faço a inscrição no lazer?', 'leisure.enroll'],
    ['Minhas inscrições', 'request.list'],
    ['Quero participar do passeio de barco', null],
    ['Quero participar do quiz', null],
  ])('detectLeisureEnrollment(%j) → %s', (message, expected) => {
    expect(detectLeisureEnrollment(t(message))).toBe(expected);
  });

  it('reads "quero participar dessa" right after a leisure programme as an enrollment', () => {
    const afterLeisure: ConversationState = { topic: 'event', lastIntent: 'event.list', event: { kind: 'leisure' } };
    expect(detectLeisureEnrollment(t('Quero participar dessa'), afterLeisure)).toBe('leisure.enroll');
    expect(detectLeisureEnrollment(t('Quero participar dessa'), { topic: 'event', lastIntent: 'event.list', event: { kind: 'event' } })).toBeNull();
  });

  it.each([
    ['Mostre o cardápio do restaurante italiano', 'restaurant.menu'],
    ['Qual o menu do Omakase?', 'restaurant.menu'],
    ['Quais pratos tem no restaurante central?', 'restaurant.menu'],
    ['Quero reservar e escolher os pratos', null],
    ['Qual o menu de massagens do spa?', null],
    ['Esse tem opção vegana?', null],
  ])('detectMenu(%j) → %s', (message, expected) => {
    expect(detectMenu(t(message))).toBe(expected);
  });

  it('uses the restaurant in conversation for "o que tem de sobremesa?"', () => {
    const state: ConversationState = { topic: 'restaurant', restaurant: { selectedId: 'rest-1' } };
    expect(detectMenu(t('O que tem de sobremesa?'), state)).toBe('restaurant.menu');
    expect(detectMenu(t('O que tem de sobremesa?'))).toBeNull();
  });

  describe('detectCatalogFollowUp', () => {
    const spaList: ConversationState = {
      lastIntent: 'spa.info',
      catalog: { kind: 'spa_service', listed: [{ id: '1', title: 'A' }, { id: '2', title: 'B' }] },
    };

    it('repeats the list intent for a position inside the last catalog list', () => {
      expect(detectCatalogFollowUp(t('me fala da segunda'), 2, spaList)).toBe('spa.info');
      expect(detectCatalogFollowUp(t('Opção 1'), 1, spaList)).toBe('spa.info');
    });

    it('ignores positions outside the list, other topics and long messages', () => {
      expect(detectCatalogFollowUp(t('a terceira'), 3, spaList)).toBeNull();
      expect(detectCatalogFollowUp(t('a segunda'), 2, { ...spaList, lastIntent: 'restaurant.list' })).toBeNull();
      expect(detectCatalogFollowUp(t('a segunda'), undefined, spaList)).toBeNull();
      expect(detectCatalogFollowUp(t('quero saber se a segunda opção do spa pode ser feita amanhã cedo'), 2, spaList)).toBeNull();
    });
  });
});
