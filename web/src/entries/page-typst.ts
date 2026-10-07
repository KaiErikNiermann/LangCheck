// Page-world entry for Typst, loaded as a `world: "MAIN"` content script.
import { startPage } from '../page/startPage';
import { typstPage, typstWorkspace } from '../sites/typst';

startPage(typstPage, typstWorkspace);
