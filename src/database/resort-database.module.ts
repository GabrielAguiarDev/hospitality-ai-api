
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      name: 'resort',
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'mysql' as const,

        host: config.getOrThrow<string>(
          'RESORT_DB_HOST',
        ),

        port: Number(
          config.getOrThrow<string>('RESORT_DB_PORT'),
        ),

        username: config.getOrThrow<string>(
          'RESORT_DB_USER',
        ),

        password: config.getOrThrow<string>(
          'RESORT_DB_PASSWORD',
        ),

        database: config.getOrThrow<string>(
          'RESORT_DB_NAME',
        ),

        // Snapshot original: nunca modificar sua estrutura.
        synchronize: false,
        migrationsRun: false,
        dropSchema: false,

        logging: false,
        entities: [],

        extra: {
          connectionLimit: 5,
        },
      }),
    }),
  ],
})
export class ResortDatabaseModule {}
