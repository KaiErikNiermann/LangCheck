// A thesis excerpt in French quoting English and Hebrew, exercising the Typst
// constructs the extractor has to get right. Every misspelling in it is
// deliberate; `expected.md` lists what a check should find and why.

#set document(title: "Le canon et sa réception", author: "A. Lecteur")
#set page(numbering: "1", margin: 2.5cm)
#set text(lang: "fr", region: "FR", size: 11pt)
#set par(justify: true)

#show heading.where(level: 1): it => [
  #set text(size: 16pt, weight: "bold")
  #it.body
]

= Le canon et sa réception

Ce chapitre examine la réception du canon dans la théologie patristique. La
question centrale est celle de l'autorité : qui décide, et sur quel fondement ?
Le mot _réception_ porte ici un sens technique qu'il faudra préciser.

== Une citation en anglais

Le passage suivant est cité dans sa langue d'origine. Il est balisé avec
`#text(lang: "en")`, donc chaque mot y est vérifié en anglais et non en
français.

#quote(block: true, attribution: [Augustine, _Confessions_ XI])[
  #text(lang: "en")[
    What then is time? If no one asks me, I know what it is. If I wish to
    explain it to him, I know not. This sentence holds a deliberatly wrong
    word, and so does recieve.
  ]
]

Notez que l'attribution ci-dessus reste en français, puisqu'elle est en dehors
du bloc anglais.

== Un terme hébreu

#text(lang: "he")[קנון] est le terme employé par les sources rabbiniques.
Aucun moteur installé ne lit l'hébreu, ce que le vérificateur signale au lieu
de laisser passer le passage en silence.

== Ce qui n'est pas de la prose

Rien de ce qui suit ne doit être vérifié comme du texte.

$ integral_0^1 f(x) dif x = sum_(i=1)^n a_i $

```rust
// Un commentaire dans un bloc de code: jamais vérifié.
let recieve = "misspelt on purpose";
```

Une formule en ligne $a^2 + b^2 = c^2$ au milieu d'une phrase ne coupe pas la
phrase en deux.

#figure(
  circle(radius: 1cm, stroke: 0.5pt),
  caption: [Une légende, elle, est de la prose et se vérifie.],
) <fig-cercle>

La figure @fig-cercle est référencée ici ; l'étiquette elle-même n'est pas du
texte à vérifier, et pas davantage l'URL #link("https://typst.app/docs").

== Désactiver le vérificateur

// lang-check-disable-next-line
Cette ligne contient une fautte volontaire et n'est pas signalée.

// lang-check-begin spelling.typo
Dans cette région, seules les fautes d'orthographe sont tues ; le reste des
règles s'applique toujours. Voici une fautte de plus.
// lang-check-end

// Une directive `lang:` l'emporte sur ce que dit le balisage, ce qui permet de
// corriger une portion sans toucher à la typographie.
// lang-check-begin lang:en-US
This paragraph is typeset as French but checked as American English, because
the directive wins. Here is a deliberatly wrong word to prove it.
// lang-check-end

== Fin

Voilà la suiste du texte en français, avec une dernière fautte pour la route.
