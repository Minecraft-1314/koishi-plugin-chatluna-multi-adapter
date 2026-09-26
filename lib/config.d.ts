import { Schema } from 'koishi';
import { Config } from './types';
declare function normalizeConfig(config: Config): void;
export declare const ConfigSchema: Schema<Config, Config>;
export { normalizeConfig };
export declare function setAvailableModels(models: string[]): void;
export declare function withSchemaDefaults(input: Config | null | undefined): Config;
