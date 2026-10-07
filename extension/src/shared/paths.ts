/**
 * The last segment of a file name, for display: what `path.basename` gives,
 * without Node, so the code that shows it also runs in a browser. Either
 * separator ends a segment, as on Windows.
 */
export function basename(fileName: string): string {
    const trimmed = fileName.replace(/[\\/]+$/u, '');
    return trimmed.slice(Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\')) + 1);
}
