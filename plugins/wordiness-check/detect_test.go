package main

import (
	"testing"
)

func TestFindWordyPhrases_Basic(t *testing.T) {
	text := "In order to succeed, you must try."
	diags := FindWordyPhrases(text)

	if len(diags) != 1 {
		t.Fatalf("expected 1 diagnostic, got %d", len(diags))
	}

	d := diags[0]
	if d.StartByte != 0 || d.EndByte != 11 {
		t.Errorf("expected offsets 0-11, got %d-%d", d.StartByte, d.EndByte)
	}
	if d.Suggestions[0] != "to" {
		t.Errorf("expected suggestion 'to', got %q", d.Suggestions[0])
	}
	if d.RuleID != "wordiness" {
		t.Errorf("expected rule_id 'wordiness', got %q", d.RuleID)
	}
}

func TestFindWordyPhrases_CaseInsensitive(t *testing.T) {
	text := "Due To The Fact That it rained, we stayed inside."
	diags := FindWordyPhrases(text)

	if len(diags) != 1 {
		t.Fatalf("expected 1 diagnostic, got %d", len(diags))
	}

	if diags[0].Suggestions[0] != "because" {
		t.Errorf("expected 'because', got %q", diags[0].Suggestions[0])
	}
}

func TestFindWordyPhrases_Multiple(t *testing.T) {
	text := "In order to proceed, at this point in time we need a large number of items."
	diags := FindWordyPhrases(text)

	if len(diags) != 3 {
		t.Fatalf("expected 3 diagnostics, got %d", len(diags))
	}

	expected := []string{"to", "now", "many"}
	for i, d := range diags {
		if d.Suggestions[0] != expected[i] {
			t.Errorf("diagnostic %d: expected suggestion %q, got %q", i, expected[i], d.Suggestions[0])
		}
	}
}

func TestFindWordyPhrases_NoMatch(t *testing.T) {
	text := "This is clean, concise text."
	diags := FindWordyPhrases(text)

	if len(diags) != 0 {
		t.Errorf("expected 0 diagnostics, got %d", len(diags))
	}
}

func TestFindWordyPhrases_WordBoundary(t *testing.T) {
	// "disorder" contains "in order" but should NOT match because of word boundaries
	text := "The disorder was severe."
	diags := FindWordyPhrases(text)

	if len(diags) != 0 {
		t.Errorf("expected 0 diagnostics (word boundary), got %d", len(diags))
	}
}

func TestFindWordyPhrases_AtStart(t *testing.T) {
	text := "Each and every time this happens."
	diags := FindWordyPhrases(text)

	if len(diags) != 1 {
		t.Fatalf("expected 1 diagnostic, got %d", len(diags))
	}
	if diags[0].StartByte != 0 {
		t.Errorf("expected start 0, got %d", diags[0].StartByte)
	}
}

func TestFindWordyPhrases_AtEnd(t *testing.T) {
	text := "We will deal with this in the near future"
	diags := FindWordyPhrases(text)

	if len(diags) != 1 {
		t.Fatalf("expected 1 diagnostic, got %d", len(diags))
	}
	if diags[0].Suggestions[0] != "soon" {
		t.Errorf("expected 'soon', got %q", diags[0].Suggestions[0])
	}
}

func TestFindWordyPhrases_Severity(t *testing.T) {
	text := "In order to test severity."
	diags := FindWordyPhrases(text)

	if len(diags) != 1 {
		t.Fatalf("expected 1 diagnostic, got %d", len(diags))
	}
	if diags[0].Severity != SeverityInformation {
		t.Errorf("expected severity %d, got %d", SeverityInformation, diags[0].Severity)
	}
}
