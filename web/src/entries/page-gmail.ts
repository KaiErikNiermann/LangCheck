// Page-world entry for Gmail, loaded as a `world: "MAIN"` content script.
import { startPage } from '../page/startPage';
import { createGmailPage, gmailWorkspace } from '../sites/gmail';

startPage(createGmailPage(), gmailWorkspace);
