import { flushSync } from 'react-dom';

export function dismissBeforeSynchronousAction(dismiss: () => void, action: () => void): void {
  flushSync(dismiss);
  action();
}
