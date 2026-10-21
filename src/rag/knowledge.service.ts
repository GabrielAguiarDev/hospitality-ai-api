import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChromaClient } from 'chromadb-client';

import { EmbeddingsService } from './embeddings.service.js';

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

  private readonly collectionName = 'yago_knowledge_demo_v1';

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

  async upsertDocuments(documents: KnowledgeDocument[]): Promise<number> {
    if (documents.length === 0) {
      return 0;
    }

    const collection = await this.getCollection();

    const embeddings = await this.embeddingsService.embed(
      documents.map(
        (document) => `title: ${document.title} | text: ${document.content}`,
      ),
    );

    await collection.upsert({
      ids: documents.map((document) => document.id),

      embeddings,

      documents: documents.map((document) => document.content),

      metadatas: documents.map((document) => ({
        title: document.title,
        category: document.category,
        resortId: 'demo',
      })),
    });

    return documents.length;
  }

  async searchByVector(vector: number[]): Promise<RetrievedDocument[]> {
    const collection = await this.getCollection();

    const count = await collection.count();

    if (count === 0) {
      return [];
    }

    const result = await collection.query({
      queryEmbeddings: [vector],
      nResults: Math.min(3, count),
      where: {
        resortId: 'demo',
      },
    });

    const ids = result.ids[0] ?? [];
    const documents = result.documents?.[0] ?? [];
    const metadatas = result.metadatas?.[0] ?? [];
    const distances = result.distances?.[0] ?? [];

    return ids.map((id, index) => ({
      id,
      title: String(metadatas[index]?.title ?? 'Documento'),
      content: documents[index] ?? '',
      distance: distances[index] ?? null,
    }));
  }
}
