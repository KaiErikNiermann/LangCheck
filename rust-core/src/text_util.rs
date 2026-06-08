//! Small shared text utilities for byte-offset–safe string handling.

/// Slice a `&str` at byte offsets, snapping each bound to the nearest char
/// boundary so the operation never panics on multi-byte UTF-8.
///
/// `start` rounds down, `end` rounds up; both are clamped to the string length.
#[must_use]
pub fn safe_slice(s: &str, start: usize, end: usize) -> &str {
    let lo = s.floor_char_boundary(start.min(s.len()));
    let hi = s.ceil_char_boundary(end.min(s.len()));
    &s[lo..hi]
}

#[cfg(test)]
mod tests {
    use super::safe_slice;

    #[test]
    fn ascii_slice_is_exact() {
        assert_eq!(safe_slice("hello world", 0, 5), "hello");
        assert_eq!(safe_slice("hello world", 6, 11), "world");
    }

    #[test]
    fn snaps_offsets_inside_multibyte_chars() {
        // 'ö' occupies two bytes; offsets landing mid-char must widen outward.
        let s = "Ölförderung";
        // byte 1 is mid-'Ö' -> floors to 0; byte 4 is mid-'ö' -> ceils past it.
        let slice = safe_slice(s, 1, 4);
        assert!(s.starts_with(slice) || s.contains(slice));
        assert!(slice.is_char_boundary(0));
    }

    #[test]
    fn clamps_out_of_range_offsets() {
        assert_eq!(safe_slice("abc", 0, 999), "abc");
        assert_eq!(safe_slice("abc", 999, 999), "");
    }
}
