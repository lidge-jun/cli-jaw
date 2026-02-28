export {
    launchChrome, connectCdp, getActivePage, getActivePort,
    listTabs, getBrowserStatus, closeBrowser,
    getCdpSession,
} from './connection.js';

export {
    snapshot, screenshot, click, type, press,
    hover, navigate, evaluate, getPageText,
    mouseClick,
} from './actions.js';

export { visionClick, extractCoordinates } from './vision.js';
