// Page-world entry for Notion, loaded as a `world: "MAIN"` content script.
import { startPage } from '../page/startPage';
import { notionPage, notionWorkspace } from '../sites/notion';

startPage(notionPage, notionWorkspace);
