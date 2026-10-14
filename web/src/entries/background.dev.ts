// The dev build's background (node esbuild.mjs --dev): the extension's own,
// and the reloader that picks up each rebuild. The release entry
// (background.ts) never imports the reloader.
import '../background/background';
import { startDevReload } from '../dev/reloadClient';

startDevReload();
