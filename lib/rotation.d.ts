import { Attempt, GroupRuntime, RotationStrategy } from './types';
export declare function resolveBaseCooldown(value: number): number;
export declare class RotationRegistry {
    private readonly _baseCooldown;
    private readonly _groups;
    private readonly _failures;
    private readonly _modelEndpoints;
    private readonly _modelLabels;
    private _plainCursor;
    constructor(_baseCooldown: number);
    setGroups(entries: {
        name: string;
        models: string[];
        strategy: RotationStrategy;
    }[]): void;
    setModelEndpoints(index: Map<string, number[]>): void;
    setModelLabels(labels: Map<string, Attempt>): void;
    getGroup(name: string): GroupRuntime | undefined;
    hasGroup(name: string): boolean;
    listGroups(): GroupRuntime[];
    resolveEndpoints(model: string): number[];
    resolvePrimaryModel(model: string): string | null;
    plan(model: string): Attempt[];
    reportSuccess(_model: string, attempt: Attempt): void;
    reportFailure(_model: string, attempt: Attempt): void;
    cooldownRemaining(key: string): number;
    private _buildAttempts;
    private _planPlainModel;
    private _planGroup;
}
