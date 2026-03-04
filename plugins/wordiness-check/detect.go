package main

import (
	"strings"
	"unicode"
)

// CheckRequest is the JSON input from the host.
type CheckRequest struct {
	Text       string `json:"text"`
	LanguageID string `json:"language_id"`
}

// Diagnostic is a single issue found in the text.
type Diagnostic struct {
	StartByte   int      `json:"start_byte"`
	EndByte     int      `json:"end_byte"`
	Message     string   `json:"message"`
	Suggestions []string `json:"suggestions"`
	RuleID      string   `json:"rule_id"`
	Severity    int      `json:"severity"`
	Confidence  float32  `json:"confidence"`
}

// WordyPhrase maps a verbose phrase to its concise replacement.
type WordyPhrase struct {
	Pattern     string
	Replacement string
}

// Severity constants matching the host protocol.
const (
	SeverityInformation = 1
	SeverityWarning     = 2
)

// Phrases is the list of wordy phrases to detect.
// All patterns are stored lowercase for case-insensitive matching.
var Phrases = []WordyPhrase{
	{"in order to", "to"},
	{"due to the fact that", "because"},
	{"at this point in time", "now"},
	{"in the event that", "if"},
	{"it is important to note that", "note that"},
	{"in the process of", "currently"},
	{"on a daily basis", "daily"},
	{"a large number of", "many"},
	{"in spite of the fact that", "although"},
	{"for the purpose of", "to"},
	{"in the near future", "soon"},
	{"has the ability to", "can"},
	{"at the present time", "now"},
	{"on the occasion of", "when"},
	{"in close proximity to", "near"},
	{"with regard to", "about"},
	{"with respect to", "about"},
	{"take into consideration", "consider"},
	{"make a decision", "decide"},
	{"come to the conclusion", "conclude"},
	{"is able to", "can"},
	{"in light of the fact that", "because"},
	{"regardless of the fact that", "although"},
	{"until such time as", "until"},
	{"in the absence of", "without"},
	{"on the basis of", "based on"},
	{"in a situation in which", "when"},
	{"each and every", "each"},
	{"first and foremost", "first"},
	{"any and all", "all"},
	{"basic and fundamental", "basic"},
	{"various and sundry", "various"},
	{"null and void", "void"},
}

// isWordBoundary reports whether the byte at position i in s is a word boundary.
func isWordBoundary(s string, i int) bool {
	if i < 0 || i >= len(s) {
		return true
	}
	return !unicode.IsLetter(rune(s[i])) && !unicode.IsDigit(rune(s[i]))
}

// FindWordyPhrases scans text for wordy phrases and returns diagnostics.
func FindWordyPhrases(text string) []Diagnostic {
	lower := strings.ToLower(text)
	var diagnostics []Diagnostic

	for _, phrase := range Phrases {
		start := 0
		for {
			idx := strings.Index(lower[start:], phrase.Pattern)
			if idx < 0 {
				break
			}
			matchStart := start + idx
			matchEnd := matchStart + len(phrase.Pattern)

			// Check word boundaries
			if isWordBoundary(lower, matchStart-1) && isWordBoundary(lower, matchEnd) {
				diagnostics = append(diagnostics, Diagnostic{
					StartByte:   matchStart,
					EndByte:     matchEnd,
					Message:     "Wordy phrase: consider using \"" + phrase.Replacement + "\" instead",
					Suggestions: []string{phrase.Replacement},
					RuleID:      "wordiness",
					Severity:    SeverityInformation,
					Confidence:  0.8,
				})
			}
			start = matchStart + 1
		}
	}

	return diagnostics
}
