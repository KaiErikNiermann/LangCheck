use ropey::Rope;

/// An open document backed by a rope data structure for efficient incremental edits.
///
/// This is the primary representation for documents being actively edited
/// in an LSP context, where frequent small edits need to be applied efficiently.
#[derive(Debug, Clone)]
pub struct Document {
    rope: Rope,
    version: i32,
    language_id: String,
}

impl Document {
    /// Create a new document from the full text content.
    #[must_use]
    pub fn new(text: &str, language_id: String) -> Self {
        Self {
            rope: Rope::from_str(text),
            version: 0,
            language_id,
        }
    }

    /// Apply an incremental edit to the document.
    ///
    /// `start_byte` and `end_byte` define the range to replace.
    /// If they are equal, this is an insertion. If `new_text` is empty,
    /// this is a deletion.
    pub fn apply_edit(&mut self, start_byte: usize, end_byte: usize, new_text: &str) {
        let start_char = self.rope.byte_to_char(start_byte);
        let end_char = self.rope.byte_to_char(end_byte);
        self.rope.remove(start_char..end_char);
        if !new_text.is_empty() {
            self.rope.insert(start_char, new_text);
        }
        self.version += 1;
    }

    /// Apply an edit using line/column (0-based) coordinates.
    pub fn apply_edit_lc(
        &mut self,
        start_line: usize,
        start_col: usize,
        end_line: usize,
        end_col: usize,
        new_text: &str,
    ) {
        let start_char = self.rope.line_to_char(start_line) + start_col;
        let end_char = self.rope.line_to_char(end_line) + end_col;
        self.rope.remove(start_char..end_char);
        if !new_text.is_empty() {
            self.rope.insert(start_char, new_text);
        }
        self.version += 1;
    }

    /// Replace the entire content (full sync).
    pub fn set_content(&mut self, text: &str) {
        self.rope = Rope::from_str(text);
        self.version += 1;
    }

    /// Get the full text content as a String.
    #[must_use]
    pub fn text(&self) -> String {
        self.rope.to_string()
    }

    /// Get a slice of text by byte range.
    #[must_use]
    pub fn slice_bytes(&self, start: usize, end: usize) -> String {
        let start_char = self.rope.byte_to_char(start);
        let end_char = self.rope.byte_to_char(end);
        self.rope.slice(start_char..end_char).to_string()
    }

    /// Get a specific line (0-indexed).
    #[must_use]
    pub fn line(&self, idx: usize) -> Option<String> {
        if idx < self.rope.len_lines() {
            Some(self.rope.line(idx).to_string())
        } else {
            None
        }
    }

    /// Convert a byte offset to (line, column) (0-based).
    #[must_use]
    pub fn byte_to_line_col(&self, byte_offset: usize) -> (usize, usize) {
        let char_idx = self.rope.byte_to_char(byte_offset);
        let line = self.rope.char_to_line(char_idx);
        let line_start = self.rope.line_to_char(line);
        let col = char_idx - line_start;
        (line, col)
    }

    /// Convert (line, column) (0-based) to a byte offset.
    #[must_use]
    pub fn line_col_to_byte(&self, line: usize, col: usize) -> usize {
        let char_idx = self.rope.line_to_char(line) + col;
        self.rope.char_to_byte(char_idx)
    }

    /// Number of lines in the document.
    #[must_use]
    pub fn line_count(&self) -> usize {
        self.rope.len_lines()
    }

    /// Length in bytes.
    #[must_use]
    pub fn len_bytes(&self) -> usize {
        self.rope.len_bytes()
    }

    /// Length in characters.
    #[must_use]
    pub fn len_chars(&self) -> usize {
        self.rope.len_chars()
    }

    /// Whether the document is empty.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.rope.len_bytes() == 0
    }

    /// The document version (increments on each edit).
    #[must_use]
    pub const fn version(&self) -> i32 {
        self.version
    }

    /// The document's language ID.
    #[must_use]
    pub fn language_id(&self) -> &str {
        &self.language_id
    }
}

/// Manages a set of open documents keyed by URI.
#[derive(Debug, Default)]
pub struct DocumentStore {
    documents: std::collections::HashMap<String, Document>,
}

impl DocumentStore {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Open (or replace) a document in the store.
    pub fn open(&mut self, uri: String, text: &str, language_id: String) {
        self.documents
            .insert(uri, Document::new(text, language_id));
    }

    /// Close a document, removing it from the store.
    pub fn close(&mut self, uri: &str) -> Option<Document> {
        self.documents.remove(uri)
    }

    /// Get an immutable reference to a document.
    #[must_use]
    pub fn get(&self, uri: &str) -> Option<&Document> {
        self.documents.get(uri)
    }

    /// Get a mutable reference to a document (for applying edits).
    pub fn get_mut(&mut self, uri: &str) -> Option<&mut Document> {
        self.documents.get_mut(uri)
    }

    /// Number of open documents.
    #[must_use]
    pub fn len(&self) -> usize {
        self.documents.len()
    }

    /// Whether the store is empty.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.documents.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_document_has_correct_text() {
        let doc = Document::new("Hello, world!", "markdown".to_string());
        assert_eq!(doc.text(), "Hello, world!");
        assert_eq!(doc.version(), 0);
        assert_eq!(doc.language_id(), "markdown");
    }

    #[test]
    fn apply_edit_insertion() {
        let mut doc = Document::new("Hello world", "markdown".to_string());
        // Replace " " with ", " between "Hello" and "world" (byte 5..6)
        doc.apply_edit(5, 6, ", ");
        assert_eq!(doc.text(), "Hello, world");
        assert_eq!(doc.version(), 1);
    }

    #[test]
    fn apply_edit_deletion() {
        let mut doc = Document::new("Hello, world!", "markdown".to_string());
        // Delete ", " (bytes 5..7)
        doc.apply_edit(5, 7, "");
        assert_eq!(doc.text(), "Helloworld!");
        assert_eq!(doc.version(), 1);
    }

    #[test]
    fn apply_edit_replacement() {
        let mut doc = Document::new("Hello, world!", "markdown".to_string());
        // Replace "world" with "Rust"
        doc.apply_edit(7, 12, "Rust");
        assert_eq!(doc.text(), "Hello, Rust!");
        assert_eq!(doc.version(), 1);
    }

    #[test]
    fn apply_edit_lc() {
        let mut doc = Document::new("line one\nline two\nline three", "markdown".to_string());
        // Replace "two" on line 1 (cols 5..8) with "TWO"
        doc.apply_edit_lc(1, 5, 1, 8, "TWO");
        assert_eq!(doc.text(), "line one\nline TWO\nline three");
    }

    #[test]
    fn set_content_replaces_all() {
        let mut doc = Document::new("old content", "markdown".to_string());
        doc.set_content("new content");
        assert_eq!(doc.text(), "new content");
        assert_eq!(doc.version(), 1);
    }

    #[test]
    fn slice_bytes() {
        let doc = Document::new("Hello, world!", "markdown".to_string());
        assert_eq!(doc.slice_bytes(7, 12), "world");
    }

    #[test]
    fn line_access() {
        let doc = Document::new("first\nsecond\nthird", "markdown".to_string());
        assert_eq!(doc.line(0).unwrap(), "first\n");
        assert_eq!(doc.line(1).unwrap(), "second\n");
        assert_eq!(doc.line(2).unwrap(), "third");
        assert!(doc.line(3).is_none());
        assert_eq!(doc.line_count(), 3);
    }

    #[test]
    fn byte_to_line_col_and_back() {
        let doc = Document::new("abc\ndef\nghi", "markdown".to_string());
        // 'd' is at byte 4, which is line 1, col 0
        let (line, col) = doc.byte_to_line_col(4);
        assert_eq!((line, col), (1, 0));
        assert_eq!(doc.line_col_to_byte(1, 0), 4);
    }

    #[test]
    fn unicode_handling() {
        let mut doc = Document::new("Hëllo wörld", "markdown".to_string());
        assert!(doc.len_bytes() > doc.len_chars());
        // Replace "wörld" with "rust" — need byte positions
        let text = doc.text();
        let start = text.find("wörld").unwrap();
        let end = start + "wörld".len();
        doc.apply_edit(start, end, "rust");
        assert_eq!(doc.text(), "Hëllo rust");
    }

    #[test]
    fn document_store_operations() {
        let mut store = DocumentStore::new();
        assert!(store.is_empty());

        store.open("file:///test.md".to_string(), "Hello", "markdown".to_string());
        assert_eq!(store.len(), 1);
        assert!(!store.is_empty());

        let doc = store.get("file:///test.md").unwrap();
        assert_eq!(doc.text(), "Hello");

        // Apply edit through mutable reference
        let doc_mut = store.get_mut("file:///test.md").unwrap();
        doc_mut.apply_edit(5, 5, ", world!");
        assert_eq!(store.get("file:///test.md").unwrap().text(), "Hello, world!");

        // Close document
        let closed = store.close("file:///test.md");
        assert!(closed.is_some());
        assert!(store.is_empty());
    }

    #[test]
    fn multiple_sequential_edits() {
        let mut doc = Document::new("The quick brown fox", "markdown".to_string());
        // Replace "quick" with "slow"
        doc.apply_edit(4, 9, "slow");
        assert_eq!(doc.text(), "The slow brown fox");
        // Replace "brown" with "red"
        doc.apply_edit(9, 14, "red");
        assert_eq!(doc.text(), "The slow red fox");
        assert_eq!(doc.version(), 2);
    }

    #[test]
    fn is_empty() {
        let doc = Document::new("", "markdown".to_string());
        assert!(doc.is_empty());
        let doc2 = Document::new("x", "markdown".to_string());
        assert!(!doc2.is_empty());
    }
}
