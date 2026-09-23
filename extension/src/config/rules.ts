/**
 * Telling a config change that can only remove diagnostics from one that
 * cannot.
 *
 * Switching a rule off is applied by the core *after* the engines have run:
 * the override maps the severity to -1 and the diagnostic is dropped
 * (`orchestrator.rs`, `rule_override_severity`). Running the engines again
 * under the new config therefore produces the same raw findings and discards
 * one more of them, so the re-check is work whose result is already known.
 *
 * That only holds while the change is subtractive. Turning a rule back on, or
 * changing a severity from error to warning, needs the check again -- the
 * first because the diagnostics were never kept, the second because the
 * severity is decided in the core and the editor is holding the old one. So
 * the cheap path is taken only when every difference is a newly silenced
 * rule, and anything else falls back to re-checking.
 */
import { parse } from 'yaml';

export type ConfigChangeKind = 'none' | 'subtractive' | 'full';

export interface ConfigChange {
    readonly kind: ConfigChangeKind;
    /**
     * Rules silenced by this change, by whichever id the config spelled --
     * the native one the diagnostic carries, or the unified category. Empty
     * unless `kind` is `subtractive`.
     */
    readonly newlyOff: ReadonlySet<string>;
}

const NO_CHANGE: ConfigChange = { kind: 'none', newlyOff: new Set() };
const FULL: ConfigChange = { kind: 'full', newlyOff: new Set() };

/** A YAML mapping, as far as this file cares. */
type Mapping = Record<string, unknown>;

function asMapping(value: unknown): Mapping {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Mapping
        : {};
}

/**
 * A deterministic rendering, so two configs can be compared by value.
 *
 * Key order in YAML is not meaningful, and `JSON.stringify` preserves
 * insertion order, so a config whose keys were merely reordered would
 * otherwise read as changed and force a re-check.
 */
function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (typeof value === 'object' && value !== null) {
        const entries = Object.entries(value as Mapping)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`);
        return `{${entries.join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
}

/** Whether a `rules:` entry silences its rule. */
function isOff(entry: unknown): boolean {
    const severity = asMapping(entry)['severity'];
    return typeof severity === 'string' && severity.toLowerCase() === 'off';
}

/**
 * Classify the difference between two config texts.
 *
 * A text that will not parse is reported as `full`: the safe answer when the
 * change cannot be read is to check again.
 */
export function classifyConfigChange(before: string, after: string): ConfigChange {
    if (before === after) return NO_CHANGE;

    let oldConfig: Mapping;
    let newConfig: Mapping;
    try {
        oldConfig = asMapping(parse(before));
        newConfig = asMapping(parse(after));
    } catch {
        return FULL;
    }

    // Everything outside `rules:` has to be identical. A changed engine, a
    // changed dictionary or a changed exclude can all add findings.
    const withoutRules = (config: Mapping): Mapping => {
        const { rules: _rules, ...rest } = config;
        return rest;
    };
    if (canonical(withoutRules(oldConfig)) !== canonical(withoutRules(newConfig))) {
        return FULL;
    }

    const oldRules = asMapping(oldConfig['rules']);
    const newRules = asMapping(newConfig['rules']);

    // Nothing that was already there may change or disappear: a rule turned
    // back on, or moved from error to warning, needs the check again.
    for (const [rule, entry] of Object.entries(oldRules)) {
        if (!(rule in newRules) || canonical(newRules[rule]) !== canonical(entry)) {
            return FULL;
        }
    }

    const newlyOff = new Set<string>();
    for (const [rule, entry] of Object.entries(newRules)) {
        if (rule in oldRules) continue;
        if (!isOff(entry)) return FULL;
        newlyOff.add(rule);
    }

    // Parsed the same, spelled differently: a comment or some whitespace
    // moved. Nothing to do at all.
    if (newlyOff.size === 0) return NO_CHANGE;

    return { kind: 'subtractive', newlyOff };
}

/**
 * Whether a diagnostic is silenced by one of `rules`.
 *
 * The config may name either the native rule id the diagnostic carries or the
 * unified category it was sorted into, and the core accepts both, so this
 * does too.
 */
export function silencedBy(
    rules: ReadonlySet<string>,
    ruleId: string | undefined,
    unifiedId: string | undefined,
): boolean {
    if (rules.size === 0) return false;
    return (ruleId !== undefined && rules.has(ruleId))
        || (unifiedId !== undefined && unifiedId !== '' && rules.has(unifiedId));
}
