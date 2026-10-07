//! Checking a document a window at a time.
//!
//! The first check of a long document is the slow one -- every prose range
//! goes to the engines, where a later check finds most of them in the result
//! cache. An editor that wants findings sooner checks it in byte windows: the
//! one in view first, then the rest. Each window is an ordinary check of the
//! whole text, which still extracts every range (extraction is cheap, and the
//! Inspector describes them all), but only the ranges the window owns go to
//! the engines.
//!
//! A range belongs to the window its first byte falls in. So the windows of a
//! tiling (`[0, w)`, `[w, 2w)`, ...) check every range exactly once, and none
//! is split: a sentence that crosses a window's end is checked whole, by the
//! window it starts in.

use super::ProseRange;

/// A half-open byte window `[start, end)` of a document.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Window {
    pub start: usize,
    pub end: usize,
}

impl Window {
    /// Whether the range starting at `start_byte` is this window's to check.
    #[must_use]
    pub const fn owns(&self, start_byte: usize) -> bool {
        self.start <= start_byte && start_byte < self.end
    }
}

/// The indices of the ranges in `ranges` that `window` owns, in order.
#[must_use]
pub fn owned_by(ranges: &[ProseRange], window: Window) -> Vec<usize> {
    ranges
        .iter()
        .enumerate()
        .filter(|(_, range)| window.owns(range.start_byte))
        .map(|(index, _)| index)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    fn range(start_byte: usize, end_byte: usize) -> ProseRange {
        ProseRange {
            start_byte,
            end_byte,
            exclusions: Vec::new(),
            language: None,
            language_span: None,
        }
    }

    #[test]
    fn a_range_belongs_to_the_window_it_starts_in() {
        let ranges = [range(0, 10), range(10, 30), range(29, 31)];
        assert_eq!(owned_by(&ranges, Window { start: 0, end: 10 }), vec![0]);
        // The second starts exactly at 10: the next window's, checked whole there.
        assert_eq!(owned_by(&ranges, Window { start: 10, end: 20 }), vec![1]);
        assert_eq!(owned_by(&ranges, Window { start: 20, end: 30 }), vec![2]);
        assert_eq!(
            owned_by(&ranges, Window { start: 5, end: 5 }),
            Vec::<usize>::new()
        );
    }

    proptest! {
        /// Every range is checked by exactly one window of a tiling, whatever
        /// the window size and however the ranges fall across the edges.
        #[test]
        fn a_tiling_checks_every_range_exactly_once(
            starts in prop::collection::btree_set(0usize..5_000, 0..60),
            width in 1usize..700,
        ) {
            let ranges: Vec<ProseRange> = starts.iter().map(|&s| range(s, s + 50)).collect();
            let length = ranges.last().map_or(0, |r| r.end_byte);
            let mut checked = vec![0u32; ranges.len()];
            let mut start = 0;
            while start <= length {
                for index in owned_by(&ranges, Window { start, end: start + width }) {
                    checked[index] += 1;
                }
                start += width;
            }
            prop_assert!(checked.iter().all(|&times| times == 1), "{checked:?}");
        }
    }
}
