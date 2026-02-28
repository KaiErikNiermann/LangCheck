/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

module.exports = grammar({
  name: "tinylang",

  extras: $ => [/[ \t\r\n]/],

  externals: $ => [$.code_block],

  rules: {
    source_file: $ => repeat($._node),

    _node: $ => choice(
      $.heading,
      $.command,
      $.display_math,
      $.inline_math,
      $.code_block,
      $.code_span,
      $.link,
      $.comment,
      $.bold,
      $.italic,
      $.text,
    ),

    // # Heading text (rest of line is heading content)
    heading: $ => prec.right(seq(
      token(prec(1, /#{1,6} /)),
      repeat(choice($.bold, $.italic, $.code_span, $.inline_math, $.text)),
    )),

    // @command{argument}
    command: $ => prec.right(seq(
      $.command_name,
      optional($.command_arg),
    )),

    command_name: $ => /@[a-zA-Z][a-zA-Z0-9_-]*/,

    command_arg: $ => seq('{', repeat($._node), '}'),

    // [text](url)
    link: $ => seq(
      $.link_text,
      $.link_url,
    ),

    link_text: $ => seq('[', repeat(choice($.bold, $.italic, $.text)), ']'),
    link_url:  $ => seq('(', /[^)]*/, ')'),

    // *bold*
    bold: $ => seq('*', $.text, '*'),

    // _italic_
    italic: $ => seq('_', $.text, '_'),

    // `inline code`
    code_span: $ => /`[^`\n]*`/,

    // $inline math$
    inline_math: $ => /\$[^$\n]+\$/,

    // $$display math$$ (can span lines, handled by regex with newlines via token)
    display_math: $ => token(seq('$$', /[^$]+/, '$$')),

    // // line comment
    comment: $ => /\/\/[^\n]*/,

    // Plain text: runs of non-special characters
    text: $ => token(prec(-1, /[^\\\{\}\[\]\(\)\n\t *_`$@#\/]+/)),
  },
});
