#set text(lang: "en", region: "US")
#set page(width: 16cm, height: auto, margin: 1.5cm)
#set par(justify: true)

= Three checkers, one span

This document is written against a config that enables Harper, LanguageTool and
Hunspell at once, all three of them reading English. Every misspelling below is
therefore found three times, at the same byte range, under the same unified
rule id -- which is exactly the case the orchestrator has to merge.

== One word, three opinions

The paragraph that follows plants words each engine has something to say about.
It is deliberatly dense: a reviewer working through it with the SpeedFix panel
should see one entry per word, not three.

We recieve the report, acknowlege the finding, and seperate the two concerns
before the committe meets. The occurence was not definately a regression, and
the maintenence window is independant of it.

== Words with long suggestion lists

A speller asked about a word close to many others returns many answers.
LanguageTool alone can return dozens for one token, which is why the merged
list is round-robin by engine rather than one engine's list followed by the
next: a naive concatenation would bury Harper's single best guess under
LanguageTool's tail.

The reciept was recieved, the beleif was releived, and the commitee
reconcieved the questionaire before the millenium.

== Where the engines disagree about the span

Hunspell trims a token to its alphabetic edges and joins an internal apostrophe
or hyphen; Harper and LanguageTool do not always agree with it or with each
other. A hyphenated or apostrophised misspelling is where the three can produce
near-miss ranges instead of identical ones.

The well-recieved paper wasn't publically available, and the author's
acknowledgement of the co-authers is missing.

== Style and grammar, which only one engine reads

Hunspell has no grammar behind it -- it is a word list and an affix table, and
it answers spelling questions only. The sentence below is spelled correctly
throughout, so it is reported by LanguageTool alone, with nothing to merge.

The committee have been deliberating the matter for a very long period of time,
and a decision was made by them to defer it.

== What is not checked at all

#raw("recieve seperate definately", lang: "text")

$ integral_0^1 x^2 dif x = 1/3 $

#link("https://example.org/recieve")[the linked text is prose]

The raw block, the equation and the URL are none of them prose. The link's
label is, and is checked like any other sentence.
