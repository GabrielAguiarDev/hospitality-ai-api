
import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { ChromaClient } from 'chromadb-client';

import { EmbeddingsService } from './embeddings.service.js';
import { enabledKnowledgeSources } from './sources/knowledge-source.js';

// Lotes menores evitam timeouts do modelo de embeddings local.
const EMBEDDING_BATCH_SIZE = 16;

export interface KnowledgeDocument {
  id: string;
  title: string;
  category: string;
  content: string;
}

export interface RetrievedDocument {
  id: string;
  title: string;
  content: string;
  distance: number | null;
}

@Injectable()
export class KnowledgeService {
  private readonly client: ChromaClient;

  // Nova coleção: não misturamos documentos antigos
  // com a estrutura multi-resort.
  private readonly collectionName =
    'yago_knowledge_multi_v2';

  constructor(
    private readonly configService: ConfigService,
    private readonly embeddingsService: EmbeddingsService,
  ) {
    this.client = new ChromaClient({
      path: this.configService.get<string>(
        'CHROMA_URL',
        'http://127.0.0.1:8000',
      ),
    });
  }

  private getCollection() {
    return this.client.getOrCreateCollection({
      name: this.collectionName,
      configuration: {
        hnsw: {
          space: 'cosine',
        },
      },
    });
  }

  private requireResortId(resortId: string): void {
    if (!resortId?.trim()) {
      throw new BadRequestException(
        'resortId é obrigatório para acessar o conhecimento.',
      );
    }
  }

  // Evita colisões entre documentos de resorts
  // e fontes diferentes que utilizem o mesmo ID.
  private documentKey(
    resortId: string,
    source: string,
    documentId: string,
  ): string {
    return [
      resortId,
      source,
      documentId,
    ]
      .map(encodeURIComponent)
      .join(':');
  }

  fingerprint(document: KnowledgeDocument): string {
    const content = JSON.stringify({
      title: document.title,
      category: document.category,
      content: document.content,
    });

    return createHash('sha256')
      .update(content)
      .digest('hex');
  }

  // Recupera hashes somente dos documentos
  // desta fonte e deste resort.
  async listIndexedHashes(
    resortId: string,
    source: string,
  ): Promise<Map<string, string>> {
    this.requireResortId(resortId);

    const collection = await this.getCollection();

    const indexed = new Map<string, string>();
    const pageSize = 100;

    let offset = 0;

    while (true) {
      const page = await collection.get({
        where: {
          $and: [
            { resortId },
            { source },
          ],
        },
        limit: pageSize,
        offset,
      });

      page.ids.forEach((_, index) => {
        const metadata = page.metadatas?.[index];

        const originalId = metadata?.documentId;
        const hash = metadata?.contentHash;

        if (
          typeof originalId === 'string' &&
          typeof hash === 'string'
        ) {
          indexed.set(originalId, hash);
        }
      });

      if (page.ids.length < pageSize) {
        break;
      }

      offset += page.ids.length;
    }

    return indexed;
  }

  // Insere e atualiza documentos de um resort.
  async upsertDocuments(
    documents: KnowledgeDocument[],
    resortId: string,
    source: string,
  ): Promise<number> {
    this.requireResortId(resortId);

    if (!source?.trim()) {
      throw new BadRequestException(
        'A fonte dos documentos é obrigatória.',
      );
    }

    if (documents.length === 0) {
      return 0;
    }

    const collection = await this.getCollection();

    const embeddings: number[][] = [];

    for (let start = 0; start < documents.length; start += EMBEDDING_BATCH_SIZE) {
      embeddings.push(
        ...(await this.embeddingsService.embed(
          documents
            .slice(start, start + EMBEDDING_BATCH_SIZE)
            .map(
              (document) =>
                `title: ${document.title} | text: ${document.content}`,
            ),
        )),
      );
    }

    await collection.upsert({
      ids: documents.map((document) =>
        this.documentKey(
          resortId,
          source,
          document.id,
        ),
      ),

      embeddings,

      documents: documents.map(
        (document) => document.content,
      ),

      metadatas: documents.map((document) => ({
        resortId,
        source,
        documentId: document.id,
        title: document.title,
        category: document.category,
        contentHash: this.fingerprint(document),
      })),
    });

    return documents.length;
  }

  // Remove documentos pertencentes somente
  // à fonte e ao resort informados.
  async deleteDocuments(
    documentIds: string[],
    resortId: string,
    source: string,
  ): Promise<void> {
    this.requireResortId(resortId);

    if (!source?.trim()) {
      throw new BadRequestException(
        'A fonte dos documentos é obrigatória.',
      );
    }

    if (documentIds.length === 0) {
      return;
    }

    const collection = await this.getCollection();

    await collection.delete({
      ids: documentIds.map((id) =>
        this.documentKey(resortId, source, id),
      ),
      where: {
        $and: [
          { resortId },
          { source },
        ],
      },
    });
  }

  // Recupera documentos específicos por ID (ex.: programação do dia),
  // sempre restritos ao resort e às fontes habilitadas.
  async getDocuments(
    documentIds: string[],
    resortId: string,
    source: string,
  ): Promise<RetrievedDocument[]> {
    this.requireResortId(resortId);

    if (documentIds.length === 0) {
      return [];
    }

    const sources = enabledKnowledgeSources(
      this.configService.get<string>('KNOWLEDGE_SOURCES'),
    );

    if (!sources.includes(source)) {
      return [];
    }

    const collection = await this.getCollection();

    const page = await collection.get({
      ids: documentIds.map((id) => this.documentKey(resortId, source, id)),
      where: {
        $and: [
          { resortId },
          { source },
        ],
      },
    });

    return page.ids.map((id, index) => {
      const metadata = page.metadatas?.[index];

      return {
        id: String(metadata?.documentId ?? id),
        title: String(metadata?.title ?? 'Documento'),
        content: page.documents?.[index] ?? '',
        // Documento selecionado deterministicamente pela data.
        distance: 0,
      };
    });
  }

  // Busca vetorial com filtro obrigatório de resort.
  async searchByVector(
    vector: number[],
    resortId: string,
  ): Promise<RetrievedDocument[]> {
    this.requireResortId(resortId);

    const collection = await this.getCollection();
    const count = await collection.count();

    if (count === 0) {
      return [];
    }

    // Somente fontes habilitadas: documentos de fontes desligadas
    // (ex.: conhecimento fictício) não são recuperados.
    const sources = enabledKnowledgeSources(
      this.configService.get<string>('KNOWLEDGE_SOURCES'),
    );

    const configuredTopK = Number(
      this.configService.get<string>('RAG_TOP_K'),
    );

    const topK =
      Number.isInteger(configuredTopK) && configuredTopK > 0 && configuredTopK <= 10
        ? configuredTopK
        : 4;

    const result = await collection.query({
      queryEmbeddings: [vector],
      nResults: Math.min(topK, count),
      where: {
        $and: [
          { resortId },
          { source: { $in: sources } },
        ],
      },
    });

    const ids = result.ids[0] ?? [];
    const documents = result.documents?.[0] ?? [];
    const metadatas = result.metadatas?.[0] ?? [];
    const distances = result.distances?.[0] ?? [];

    return ids.map((id, index) => {
      const metadata = metadatas[index];

      return {
        // Preserva o ID original no retorno do RAG.
        id: String(metadata?.documentId ?? id),
        title: String(
          metadata?.title ?? 'Documento',
        ),
        content: documents[index] ?? '',
        distance: distances[index] ?? null,
      };
    });
  }
}
