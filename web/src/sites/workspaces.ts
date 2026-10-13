// Every site's workspace, by id, for the background (registry.ts). Typed
// over the catalog's ids, so a site in the catalog with no module here does
// not compile, and a module cannot name a site the catalog does not have.
import type { SiteId } from './catalog';
import { site as gmail } from './gmail';
import { site as notion } from './notion';
import { site as overleaf } from './overleaf';
import type { SiteModule } from './site';
import { site as typst } from './typst';

export const SITE_MODULES: { readonly [Id in SiteId]: SiteModule } = { overleaf, typst, notion, gmail };
