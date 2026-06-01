import { makeAutoObservable } from 'mobx';

export type ContextPromptFocusTarget = {
  requestId: string;
  sessionId: string;
  promptId?: string;
  promptIndex?: number;
};

class ContextPanelFocusStore {
  promptTarget: ContextPromptFocusTarget | null = null;

  constructor() {
    makeAutoObservable(this);
  }

  focusPrompt(args: Omit<ContextPromptFocusTarget, 'requestId'>): void {
    this.promptTarget = {
      requestId: crypto.randomUUID(),
      ...args,
    };
  }
}

export const contextPanelFocusStore = new ContextPanelFocusStore();
