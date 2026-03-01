/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

module.exports = grammar({
  name: "forester",

  extras: $ => [/[ \t\r\n]/],

  externals: $ => [$.verbatim],

  rules: {
    source_file: $ => repeat($._node),

    _node: $ => choice(
      $.command,
      $.display_math,
      $.inline_math,
      $.verbatim,
      $.wiki_link,
      $.escape,
      $.brace_group,
      $.bracket_group,
      $.paren_group,
      $.comment,
      $.text,
    ),

    // \name followed by zero or more argument groups
    command: $ => prec.right(seq(
      $.command_name,
      repeat(choice(
        $.brace_group,
        $.bracket_group,
        $.paren_group,
      )),
    )),

    // Backslash command names: \xmlns:prefix, \<xml:tag>, \name
    command_name: $ => token(choice(
      /\\xmlns:[a-zA-Z]+/,
      /\\<[A-Za-z][A-Za-z0-9\-]*(?::[A-Za-z][A-Za-z0-9\-]*)?>/,
      /\\[A-Za-z0-9\-\/\?\*]+/,
    )),

    // Delimited groups
    brace_group:   $ => seq('{', repeat($._node), '}'),
    bracket_group: $ => seq('[', repeat($._node), ']'),
    paren_group:   $ => seq('(', repeat($._node), ')'),

    // Math: ##{...} must be before #{...} for correct precedence
    display_math: $ => seq('##{', repeat($._math_node), '}'),
    inline_math:  $ => seq('#{',  repeat($._math_node), '}'),

    _math_node: $ => choice(
      $.math_escape,
      $.math_command,
      $.math_brace_group,
      $.math_bracket_group,
      $.math_paren_group,
      $.math_text,
    ),

    // Escape sequences inside math: \{ \} \\ \, \  etc.
    // Higher precedence than math_command so \{ is consumed as
    // an escape rather than starting a command parse.
    math_escape: $ => token(prec(1, /\\[\\\{\}\[\]#%, "`;_\|&]/)),

    math_command: $ => prec.right(seq(
      $.command_name,
      repeat(choice(
        $.math_brace_group,
        $.math_bracket_group,
        $.math_paren_group,
      )),
    )),

    math_brace_group:   $ => seq('{', repeat($._math_node), '}'),
    math_bracket_group: $ => seq('[', repeat($._math_node), ']'),
    math_paren_group:   $ => seq('(', repeat($._math_node), ')'),

    // Math text: anything that isn't a special char inside math
    math_text: $ => token(prec(-1, /[^\\\{\}\[\]\(\)\n\t\r ]+/)),

    // Escape sequences: \\ \{ \} \[ \] \# \% \  \, \" \` \; \_ \|
    escape: $ => /\\[\\\{\}\[\]#%, "`;_\|]/,

    // Wiki links: [[...]]
    wiki_link: $ => token(seq('[[', /[^\]\n]*/, ']]')),

    // Line comments: % to end of line
    comment: $ => /%[^\n]*/,

    // Plain text: runs of non-special characters (backtick excluded)
    text: $ => token(prec(-1, /[^\\\{\}\[\]\(\)\n\t %`]+/)),
  },
});
