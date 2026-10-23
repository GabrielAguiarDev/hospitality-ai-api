var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
let ResortDatabaseModule = class ResortDatabaseModule {
};
ResortDatabaseModule = __decorate([
    Module({
        imports: [
            TypeOrmModule.forRootAsync({
                name: 'resort',
                imports: [ConfigModule],
                inject: [ConfigService],
                useFactory: (config) => ({
                    type: 'mysql',
                    host: config.getOrThrow('RESORT_DB_HOST'),
                    port: Number(config.getOrThrow('RESORT_DB_PORT')),
                    username: config.getOrThrow('RESORT_DB_USER'),
                    password: config.getOrThrow('RESORT_DB_PASSWORD'),
                    database: config.getOrThrow('RESORT_DB_NAME'),
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
], ResortDatabaseModule);
export { ResortDatabaseModule };
//# sourceMappingURL=resort-database.module.js.map