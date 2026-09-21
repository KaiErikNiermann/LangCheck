/**
 * Ctrl+K command palette for the docs, built on the vendored ninja-keys
 * web component.
 *
 * The action list comes from `command-palette-index.json`, which the
 * `command_palette` Sphinx extension writes at the end of every HTML build:
 * every page, every heading anchor, and the project links from `html_context`.
 * Nothing here is hard-coded, so adding a page adds a palette entry.
 */

import './vendor/ninja-keys.bundled.js';

const INDEX_URL = new URL('./command-palette-index.json', import.meta.url);
const SITE_ROOT = new URL('../', import.meta.url);

const IS_APPLE = /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);

const svg = (paths) =>
  `<svg class="ninja-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
  `stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const ICONS = {
  page: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6"/><path d="M9 17h4"/>'),
  heading: svg('<path d="M4 9h16"/><path d="M4 15h16"/><path d="M10 3 8 21"/><path d="M16 3l-2 18"/>'),
  external: svg('<path d="M15 3h6v6"/><path d="M21 3 10 14"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
};

/** Navigate to a URL that the index stored relative to the site root. */
const go = (url) => {
  window.location.assign(new URL(url, SITE_ROOT).href);
};

/**
 * Pages at the top level, their headings one level in.
 *
 * ninja-keys takes the tree either nested or pre-flattened, and this is the
 * flat form on purpose: nesting sends it down a code path that leaks the
 * running parent id across siblings, so every page after the first ends up
 * filed under the first one. Passing id strings as `children` skips it.
 */
const pageActions = (page) => [
  {
    id: page.url,
    title: page.title,
    section: page.section,
    icon: ICONS.page,
    keywords: page.url.replace(/[/#.-]/g, ' '),
    children: page.headings.map((heading) => heading.url),
    handler: () => go(page.url),
  },
  ...page.headings.map((heading) => ({
    id: heading.url,
    parent: page.url,
    title: heading.title,
    section: page.title,
    icon: ICONS.heading,
    keywords: page.title,
    handler: () => go(heading.url),
  })),
];

const linkAction = (link) => ({
  id: link.url,
  title: link.title,
  section: 'Project',
  icon: ICONS.external,
  handler: () => window.open(link.url, '_blank', 'noopener'),
});

/**
 * Full-text fallback. ninja-keys matches titles and keywords only, so a query
 * that hits no heading hands the search over to Sphinx's own index. The query
 * sits in the title, which is what keeps this entry matching whatever is typed.
 */
const searchAction = (searchUrl, query) => ({
  id: 'full-text-search',
  title: `Search all pages for "${query}"`,
  section: 'Search',
  icon: ICONS.search,
  handler: () => go(`${searchUrl}?q=${encodeURIComponent(query)}`),
});

/** Put a Ctrl+K badge in Furo's sidebar search box and route it to the palette. */
const wireSearchBox = (palette) => {
  for (const form of document.querySelectorAll('.sidebar-search-container')) {
    const input = form.querySelector('.sidebar-search');
    if (!input || form.querySelector('.lc-search-hint')) {
      continue;
    }

    const hint = document.createElement('span');
    hint.className = 'lc-search-hint';
    hint.setAttribute('aria-hidden', 'true');
    for (const key of IS_APPLE ? ['⌘', 'K'] : ['Ctrl', 'K']) {
      if (hint.childElementCount > 0) {
        const plus = document.createElement('span');
        plus.className = 'lc-kbd-plus';
        plus.textContent = '+';
        hint.append(plus);
      }
      const kbd = document.createElement('kbd');
      kbd.className = 'lc-kbd';
      kbd.textContent = key;
      hint.append(kbd);
    }
    form.append(hint);

    input.setAttribute('aria-keyshortcuts', IS_APPLE ? 'Meta+K' : 'Control+K');
    // The box now advertises the palette, so it opens the palette. Blocking
    // focus on mousedown keeps the caret out of a field nothing types into.
    input.addEventListener('mousedown', (event) => {
      event.preventDefault();
      palette.open();
    });
    input.addEventListener('focus', () => {
      input.blur();
      palette.open();
    });
  }
};

const init = async () => {
  const response = await fetch(INDEX_URL);
  if (!response.ok) {
    throw new Error(`palette index: ${response.status} ${response.statusText}`);
  }
  const index = await response.json();
  const actions = [...index.pages.flatMap(pageActions), ...index.links.map(linkAction)];

  const palette = document.createElement('ninja-keys');
  palette.placeholder = 'Search the documentation...';
  palette.noAutoLoadMdIcons = true;
  palette.data = actions;
  palette.addEventListener('change', (event) => {
    const query = event.detail.search;
    palette.data = query ? [...actions, searchAction(index.searchUrl, query)] : actions;
  });
  document.body.append(palette);

  wireSearchBox(palette);
};

init().catch((error) => {
  // Without the index there is no palette, so the search box keeps Furo's own
  // behaviour and never advertises a shortcut that does nothing.
  console.error('Command palette disabled:', error);
});
