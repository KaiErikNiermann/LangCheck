/**
 * The engines the core can run, as the Inspector's engine table lists them,
 * in its order. Pure data, so the browser extension lists the same engines.
 */
export interface EngineSpec {
    readonly name: 'harper' | 'languagetool' | 'vale' | 'proselint';
    /** 'builtin' engines are always available; 'external' ones run outside the core. */
    readonly type: 'builtin' | 'external';
    /** Whether `engines.<name>` is on when the config does not say. */
    readonly enabledByDefault: boolean;
    /** The program that must be on PATH, for engines the core starts as a process. */
    readonly binary?: string;
    /**
     * The engine's own config files, first found wins; absent when the
     * engine is configured in `.languagecheck.yaml` itself.
     */
    readonly configFiles?: readonly string[];
}

export const ENGINES: readonly EngineSpec[] = [
    { name: 'harper', type: 'builtin', enabledByDefault: true },
    // A server, not a binary: always "available", and down when it does not answer.
    { name: 'languagetool', type: 'external', enabledByDefault: false },
    { name: 'vale', type: 'external', enabledByDefault: false, binary: 'vale', configFiles: ['.vale.ini', '.vale.yaml', '.vale.yml'] },
    { name: 'proselint', type: 'external', enabledByDefault: false, binary: 'proselint', configFiles: ['proselint.json', '.proselintrc'] },
];
