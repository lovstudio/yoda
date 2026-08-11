import type { BrowserSessionHealthAttention } from '@shared/browser-session-health';
import { launchEgoLite } from './ego-browser-client';

export type BrowserSessionHealthNotifier = (
  attention: BrowserSessionHealthAttention
) => void | Promise<void>;

export const notifyBrowserSessionAttention: BrowserSessionHealthNotifier = async (attention) => {
  const { Notification } = await import('electron');
  if (!Notification.isSupported()) return;
  const notification = new Notification({
    title: attention.title,
    body: attention.message,
    silent: false,
  });
  notification.once('click', () => {
    void launchEgoLite(true).catch(() => undefined);
  });
  notification.show();
};
