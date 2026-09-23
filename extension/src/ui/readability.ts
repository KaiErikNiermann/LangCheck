/** Word, sentence and character counts for the insights status bar, and the ARI they give. */
export interface ProseMetrics {
    wordCount: number;
    sentenceCount: number;
    charCount: number;
    /** 0 when there is nothing to measure. */
    readingLevel: number;
}

/**
 * Automated Readability Index over plain prose:
 * $ARI = 4.71\frac{charCount}{wordCount} + 0.5\frac{wordCount}{sentenceCount} - 21.43$
 */
export function proseMetrics(proseText: string): ProseMetrics {
    const wordCount = proseText.split(/\s+/).filter(w => w.length > 0 && /[a-zA-Z0-9]/.test(w)).length;
    const charCount = proseText.replace(/[^a-zA-Z0-9'’\-–—]/g, '').length;
    // Sentence detection: split on sentence-ending punctuation followed by
    // whitespace or end-of-string, collapsing runs like "..." or "?!"
    const sentenceCount = (proseText.match(/[.!?]+(?:\s|["')”](?:\s|$)|$)/g) ?? []).length
        || (wordCount > 0 ? 1 : 0);

    let readingLevel = 0;
    if (wordCount > 0 && sentenceCount > 0) {
        readingLevel = 4.71 * (charCount / wordCount) + 0.5 * (wordCount / sentenceCount) - 21.43;
    }
    return { wordCount, sentenceCount, charCount, readingLevel };
}
