import { Injectable } from '@nestjs/common';

import { compactText, stripSymbols, summarizeText } from '../common/text.js';

import { ResortSnapshotGateway } from './resort-snapshot.gateway.js';

export interface MenuDishInfo {
  id: string;
  name: string;
  description: string | null;
  // Porção compartilhada: serve N pessoas (R-GAS-10). null quando não cadastrado.
  serves: number | null;
  // Arquivo da imagem no bucket do app (pasta "menu"), sem URL.
  image: string | null;
}

export interface MenuCategoryInfo {
  id: string;
  // "Principal - Vegetariano" para subcategorias (id_referencia).
  name: string;
  dishes: MenuDishInfo[];
}

export interface RestaurantMenu {
  restaurantId: string;
  categories: MenuCategoryInfo[];
}

interface CategoryRow {
  id: string;
  name: string | null;
  parent: string | null;
}

interface DishRow {
  id: string;
  categoryId: string;
  name: string | null;
  description: string | null;
  serves: number | null;
  image: string | null;
}

const text = (value: string | null, max: number) => stripSymbols(compactText(value, max)) || null;

// Somente nomes de arquivo simples: nada de caminhos ou URLs do cadastro.
export function imageFile(value: string | null | undefined): string | null {
  const file = value?.trim();
  return file && file.length <= 200 && /^[^/\\]+\.(?:jpe?g|png|webp|gif|svg)$/i.test(file) ? file : null;
}

/**
 * Cardápio publicado de um restaurante no snapshot (tb_catcardapio +
 * tb_cardapio). Mesmos filtros do app: ativo e ordem > 0. Somente leitura.
 */
@Injectable()
export class RestaurantMenusService {
  constructor(private readonly snapshot: ResortSnapshotGateway) {}

  async forRestaurant(restaurantId: string): Promise<RestaurantMenu> {
    const [categories, dishes] = await Promise.all([
      this.snapshot.select<CategoryRow>(
        `
          SELECT
            c.id_catcardapio AS id,
            c.nome_catcardapio AS name,
            p.nome_catcardapio AS parent
          FROM tb_catcardapio c
          LEFT JOIN tb_catcardapio p
            ON p.id_catcardapio = c.id_referencia
          WHERE c.id_restaurante = ?
            AND c.situation_catcardapio = 1
            AND c.ordem_catcardapio > 0
          ORDER BY COALESCE(p.ordem_catcardapio, c.ordem_catcardapio) ASC,
            c.id_referencia IS NOT NULL ASC,
            c.ordem_catcardapio ASC
          LIMIT 60
        `,
        [restaurantId],
      ),
      this.snapshot.select<DishRow>(
        `
          SELECT
            m.id_cardapio AS id,
            m.id_catcardapio AS categoryId,
            m.nome_cardapio AS name,
            m.descricao_cardapio AS description,
            m.serve_cardapio AS serves,
            m.imagem_cardapio AS image
          FROM tb_cardapio m
          INNER JOIN tb_catcardapio c
            ON c.id_catcardapio = m.id_catcardapio
          WHERE c.id_restaurante = ?
            AND m.situacao_cardapio = 1
            AND m.ordem_cardapio > 0
          ORDER BY m.ordem_cardapio ASC, m.nome_cardapio ASC
          LIMIT 400
        `,
        [restaurantId],
      ),
    ]);

    return {
      restaurantId,
      categories: categories
        .map((row) => {
          const name = text(row.name, 80) ?? 'Cardápio';
          const parent = text(row.parent, 60);
          return {
            id: String(row.id),
            name: compactText(parent ? `${parent} - ${name}` : name, 120),
            dishes: dishes
              .filter((dish) => String(dish.categoryId) === String(row.id))
              .map((dish) => ({
                id: String(dish.id),
                name: text(dish.name, 160) ?? 'Prato',
                description: summarizeText(dish.description, 300) || null,
                serves: dish.serves !== null && Number(dish.serves) >= 1 ? Number(dish.serves) : null,
                image: imageFile(dish.image),
              })),
          };
        })
        // Categoria sem pratos publicados não aparece no cardápio.
        .filter((category) => category.dishes.length > 0),
    };
  }
}
