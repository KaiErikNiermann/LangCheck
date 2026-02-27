# Extension API

Language Check exposes a public API for other VS Code extensions to consume.

## Accessing the API

```typescript
const langCheck = vscode.extensions.getExtension('gemini.extension');
if (langCheck) {
    const api = await langCheck.activate();
    // Use the API...
}
```

## API Methods

### `checkDocument(uri: Uri): Promise<Diagnostic[]>`

Check a document and return diagnostics without displaying them in the editor.

```typescript
const diagnostics = await api.checkDocument(someUri);
for (const d of diagnostics) {
    console.log(`${d.ruleId}: ${d.message} [${d.startByte}..${d.endByte}]`);
}
```

### `registerIgnoreRanges(uri: Uri, ranges: Array<{start: number, end: number}>): void`

Register byte ranges to ignore during checking. Useful for extensions that manage their own regions (e.g., code blocks, front matter).

### `clearIgnoreRanges(uri: Uri): void`

Remove previously registered ignore ranges for a document.

### `registerLanguageQuery(languageId: string, query: string): void`

Register a custom tree-sitter query for extracting prose from a language. This allows other extensions to add prose-checking support for custom file types.

### `registerExternalProvider(provider: ExternalProviderConfig): void`

Programmatically register an external checker provider at runtime, without requiring config file changes.

## Diagnostic Interface

```typescript
interface LanguageCheckDiagnostic {
    startByte: number;
    endByte: number;
    message: string;
    ruleId: string;
    unifiedId: string;
    severity: 'error' | 'warning' | 'information' | 'hint';
    suggestions: string[];
    confidence: number;
}
```
