/**
 * Suggesting the Red Hat YAML extension, once.
 *
 * The manifest registers a JSON Schema for `.languagecheck.yaml`, but VS Code
 * has no YAML language server of its own: completion and validation in the
 * config file come from `redhat.vscode-yaml`, which reads that registration.
 * It is suggested, not declared as a dependency, because not everyone wants a
 * second language server installed for one file.
 */
import type { PromptMemory } from '../core/packPrompt';

export const YAML_EXTENSION_ID = 'redhat.vscode-yaml';
const DECLINED_KEY = 'language-check.yamlExtensionDeclined';

/** Whether `fsPath` is a YAML config file the schema applies to. */
export function isYamlConfig(fsPath: string): boolean {
    return /(^|[\\/])\.languagecheck\.ya?ml$/.test(fsPath);
}

/** Whether to offer the YAML extension for this document. */
export function shouldSuggestYaml(
    memory: PromptMemory,
    offeredThisSession: boolean,
    yamlInstalled: boolean,
    fsPath: string,
): boolean {
    return (
        isYamlConfig(fsPath) &&
        !yamlInstalled &&
        !offeredThisSession &&
        !memory.get<boolean>(DECLINED_KEY, false)
    );
}

export async function declineYamlSuggestion(memory: PromptMemory): Promise<void> {
    await memory.update(DECLINED_KEY, true);
}
