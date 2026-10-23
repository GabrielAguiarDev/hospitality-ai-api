
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';

import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ChatModule } from './chat/chat.module.js';
import { OperationsModule } from './operations/operations.module.js';
import { ResortDatabaseModule } from './database/resort-database.module.js';
import { AI_MIGRATIONS, AI_MIGRATIONS_TABLE } from './database/ai-migrations.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'mysql',
        host: config.getOrThrow<string>('DB_HOST'),
        port: Number(config.getOrThrow<string>('DB_PORT')),
        username: config.getOrThrow<string>('DB_USER'),
        password: config.getOrThrow<string>('DB_PASSWORD'),
        database: config.getOrThrow<string>('DB_NAME'),

        autoLoadEntities: true,
        synchronize: false,

        // Executadas explicitamente: pnpm migration:run
        migrations: AI_MIGRATIONS,
        migrationsTableName: AI_MIGRATIONS_TABLE,
        migrationsRun: false,
      }),
    }),
    ScheduleModule.forRoot(),
    ChatModule,
    OperationsModule,
    ResortDatabaseModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
