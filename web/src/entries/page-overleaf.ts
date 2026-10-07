// Page-world entry for Overleaf, loaded as a `world: "MAIN"` content script.
import { startPage } from '../page/startPage';
import { overleafPage } from '../sites/overleaf';

startPage(overleafPage);
