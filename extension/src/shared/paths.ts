/**
 * The last segment of a file name, for display: what `path.basename` gives,
 * without Node, so the code that shows it also runs in a browser. Either
 * separator ends a segment, as on Windows.
 */
export function basename(fileName: string): string {
    let end = fileName.length;
    while (end > 0 && (fileName[end - 1] === '/' || fileName[end - 1] === '\\')) end--;
    const trimmed = fileName.slice(0, end);
    return trimmed.slice(Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\')) + 1);
}
