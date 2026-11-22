/* A desktop notice for when this tab isn't in view, so a check-in reaches someone deep in another window.
   Asked for once, when a block starts, since that's a click. Everything here is optional: no permission,
   no support or a blocked call just means the chime and the tab title do the asking. */
const supported = () => typeof window !== 'undefined' && 'Notification' in window;

export function askToNotify() {
  try {
    if (supported() && Notification.permission === 'default') Promise.resolve(Notification.requestPermission()).catch(() => {});
  } catch { /* see above */ }
}

export function notify(title, body, tag) {
  try {
    if (!supported() || Notification.permission !== 'granted' || !document.hidden) return null;
    const notice = new Notification(title, { body, tag, requireInteraction: true });
    notice.onclick = () => {
      window.focus();
      notice.close();
    };
    return notice;
  } catch {
    return null;
  }
}
