import { beforeEach, describe, expect, it } from 'vitest';

import {
    declinePack,
    declinedPacks,
    forgetDecline,
    isLanguageTag,
    languageToolCovers,
    languageToolIsAnOption,
    shouldPrompt,
    uncheckedLanguages,
    type PromptMemory,
} from '../core/packPrompt';

/** An in-memory stand-in for the extension host's global state. */
function memory(): PromptMemory {
    const store = new Map<string, unknown>();
    return {
        get: <T>(key: string, fallback: T) => (store.has(key) ? (store.get(key) as T) : fallback),
        update: async (key: string, value: unknown) => {
            store.set(key, value);
        },
    };
}

describe('uncheckedLanguages', () => {
    it('reports the language the core named', () => {
        expect(
            uncheckedLanguages([
                { code: 'languagecheck.no-provider', language: 'he', packInstallable: true },
            ]),
        ).toEqual([{ language: 'he', installable: true }]);
    });

    it('ignores every other diagnostic', () => {
        expect(
            uncheckedLanguages([
                { code: 'harper.Spelling', language: 'he', packInstallable: true },
                { code: 'languagecheck.engine-error', language: 'he', packInstallable: false },
            ]),
        ).toEqual([]);
    });

    it('reports a language once however many ranges mention it', () => {
        const many = Array.from({ length: 12 }, () => ({
            code: 'languagecheck.no-provider',
            language: 'he',
            packInstallable: true,
        }));
        expect(uncheckedLanguages(many)).toHaveLength(1);
    });

    it('skips a diagnostic with no language on it', () => {
        // Older cores did not set the field; guessing from the message is
        // what this whole design exists to avoid.
        expect(uncheckedLanguages([{ code: 'languagecheck.no-provider' }])).toEqual([]);
    });
});

describe('isLanguageTag', () => {
    it('accepts the shapes a document really declares', () => {
        for (const tag of ['he', 'la', 'en-GB', 'de-DE', 'ca-ES-valencia', 'zh-CN']) {
            expect(isLanguageTag(tag), tag).toBe(true);
        }
    });

    it('rejects anything else, because the prompt is intrusive', () => {
        for (const value of ['', 'x', 'english', 'he!', '../../etc/passwd', 'he -- rm -rf /', '12']) {
            expect(isLanguageTag(value), value).toBe(false);
        }
    });
});

describe('shouldPrompt', () => {
    let store: PromptMemory;
    beforeEach(() => {
        store = memory();
    });

    it('offers a pack that can actually be fetched', () => {
        expect(shouldPrompt(store, new Set(), { language: 'he', installable: true })).toBe(true);
    });

    it('stays quiet when there is nothing to install', () => {
        // Offering Latin, which ships only as an archive, would be an offer
        // the extension cannot honour.
        expect(shouldPrompt(store, new Set(), { language: 'la', installable: false })).toBe(false);
    });

    it('stays quiet for a tag that is not a tag', () => {
        expect(shouldPrompt(store, new Set(), { language: 'not a language', installable: true }))
            .toBe(false);
    });

    it('asks once per session', () => {
        const asked = new Set<string>();
        expect(shouldPrompt(store, asked, { language: 'he', installable: true })).toBe(true);
        asked.add('he');
        expect(shouldPrompt(store, asked, { language: 'he', installable: true })).toBe(false);
    });

    it('never asks again once declined', async () => {
        await declinePack(store, 'he');
        expect(shouldPrompt(store, new Set(), { language: 'he', installable: true })).toBe(false);
    });

    it('treats a decline as covering the same tag written differently', async () => {
        await declinePack(store, 'en-GB');
        expect(shouldPrompt(store, new Set(), { language: 'en_gb', installable: true })).toBe(false);
        expect(shouldPrompt(store, new Set(), { language: 'EN-GB', installable: true })).toBe(false);
    });

    it('declining one language does not silence another', async () => {
        await declinePack(store, 'he');
        expect(shouldPrompt(store, new Set(), { language: 'de', installable: true })).toBe(true);
    });

    it('records a decline once however often it is made', async () => {
        await declinePack(store, 'he');
        await declinePack(store, 'he');
        expect(declinedPacks(store)).toEqual(['he']);
    });

    it('can be undone, which is what the quick fix does', async () => {
        await declinePack(store, 'he');
        await forgetDecline(store, 'he');
        expect(shouldPrompt(store, new Set(), { language: 'he', installable: true })).toBe(true);
    });
});

describe('a refusal survives everything that is not the user changing their mind', () => {
    /**
     * A store whose contents outlive the handle, the way the extension host's
     * globalState outlives a window reload.
     */
    function persistentStore() {
        const disk = new Map<string, unknown>();
        return {
            disk,
            /** A fresh handle onto the same storage — what a reload produces. */
            handle: (): PromptMemory => ({
                get: <T>(key: string, fallback: T) =>
                    disk.has(key) ? (disk.get(key) as T) : fallback,
                update: async (key: string, value: unknown) => {
                    disk.set(key, value);
                },
            }),
        };
    }

    it('survives a window reload', async () => {
        const store = persistentStore();
        await declinePack(store.handle(), 'he');

        // Reload: new handle, new session set, same storage.
        const afterReload = store.handle();
        expect(shouldPrompt(afterReload, new Set(), { language: 'he', installable: true }))
            .toBe(false);
    });

    it('survives many reloads', async () => {
        const store = persistentStore();
        await declinePack(store.handle(), 'he');
        for (let i = 0; i < 5; i++) {
            expect(shouldPrompt(store.handle(), new Set(), { language: 'he', installable: true }))
                .toBe(false);
        }
    });

    it('survives a config change, which clears the caches but not this', async () => {
        // reinitializeAndRecheck drops the diagnostic and extraction caches and
        // re-checks every open document, which calls straight back into the
        // offer. The refusal is the user's standing answer, not state derived
        // from the config, so it has to outlast that.
        const store = persistentStore();
        await declinePack(store.handle(), 'he');

        const sessionSetClearedByRecheck = new Set<string>();
        expect(
            shouldPrompt(store.handle(), sessionSetClearedByRecheck, {
                language: 'he',
                installable: true,
            }),
        ).toBe(false);
    });

    it('is keyed by language, so a second language still gets asked once', async () => {
        const store = persistentStore();
        await declinePack(store.handle(), 'he');
        expect(shouldPrompt(store.handle(), new Set(), { language: 'la', installable: true }))
            .toBe(true);
    });

    it('is stored under a stable key, so an upgrade does not forget it', async () => {
        const store = persistentStore();
        await declinePack(store.handle(), 'he');
        expect([...store.disk.keys()]).toEqual(['languageCheck.declinedPacks']);
        expect(store.disk.get('languageCheck.declinedPacks')).toEqual(['he']);
    });

    it('only the user asking to install undoes it', async () => {
        const store = persistentStore();
        await declinePack(store.handle(), 'he');
        // The quick fix is the one path that clears it.
        await forgetDecline(store.handle(), 'he');
        expect(shouldPrompt(store.handle(), new Set(), { language: 'he', installable: true }))
            .toBe(true);
    });

    it('a dismissed modal is not a refusal and is not written down', async () => {
        // "Not now" must not become "never", or a stray Escape silences a
        // language for good.
        const store = persistentStore();
        const session = new Set<string>(['he']);
        expect(store.disk.size).toBe(0);
        expect(shouldPrompt(store.handle(), session, { language: 'he', installable: true }))
            .toBe(false);
        // ...and it is asked again in the next session.
        expect(shouldPrompt(store.handle(), new Set(), { language: 'he', installable: true }))
            .toBe(true);
    });
});

describe('languageToolCovers', () => {
    it('knows the languages LanguageTool ships', () => {
        for (const tag of ['fr', 'de-DE', 'pt-BR', 'uk', 'zh-CN']) {
            expect(languageToolCovers(tag), tag).toBe(true);
        }
    });

    it('knows the ones it does not', () => {
        // The two that motivated the Hunspell engine in the first place.
        expect(languageToolCovers('he')).toBe(false);
        expect(languageToolCovers('la')).toBe(false);
    });

    it('does not treat rubbish as a language', () => {
        expect(languageToolCovers('')).toBe(false);
        expect(languageToolCovers('english')).toBe(false);
    });
});

describe('languageToolIsAnOption', () => {
    it('offers LanguageTool for a language it covers when the config leaves it off', () => {
        expect(languageToolIsAnOption('de', 'engines:\n  harper: true\n')).toBe(true);
        expect(languageToolIsAnOption('de', undefined)).toBe(true);
    });

    it('does not offer what the config has already switched on', () => {
        expect(languageToolIsAnOption('de', 'engines:\n  languagetool: true\n')).toBe(false);
        expect(languageToolIsAnOption('de', 'engines:\n  languagetool:\n    enabled: true\n')).toBe(false);
    });

    it('does not offer it for a language it does not cover', () => {
        expect(languageToolIsAnOption('he', 'engines:\n  harper: true\n')).toBe(false);
    });
});
