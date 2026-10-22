
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';

import { KnowledgeIngestionService } from './knowledge-ingestion.service.js';

@Injectable()
export class KnowledgeSyncScheduler {
  private readonly logger = new Logger(
    KnowledgeSyncScheduler.name,
  );

  constructor(
    private readonly ingestionService: KnowledgeIngestionService,
    private readonly configService: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES, {
    name: 'mysql-demo-knowledge-sync',
    waitForCompletion: true,
  })
  async handleSync(): Promise<void> {
    const enabled =
      this.configService.get<string>(
        'KNOWLEDGE_SYNC_ENABLED',
      ) === 'true';

    if (!enabled) {
      return;
    }

    try {
      const result =
        await this.ingestionService.syncDemo();

      this.logger.log(
        `Sincronização automática: ${JSON.stringify(result)}`,
      );
    } catch (error: unknown) {
      const details =
        error instanceof Error
          ? error.stack
          : String(error);

      this.logger.error(
        'Falha na sincronização automática',
        details,
      );
    }
  }
}
