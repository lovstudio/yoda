export class UpdateCheckTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Update check timed out after ${Math.round(timeoutMs / 1000)} seconds`);
    this.name = 'UpdateCheckTimeoutError';
  }
}

type UpdateCheckOperation<T> = (signal: AbortSignal) => Promise<T>;
type UpdateCheckErrorHandler = (error: unknown) => void;
type UpdateCheckSettledHandler = () => void;

export class UpdateCheckCoordinator<T> {
  private current: Promise<T> | null = null;
  private activeController: AbortController | null = null;
  private disposed = false;

  constructor(private readonly timeoutMs: number) {}

  run(
    operation: UpdateCheckOperation<T>,
    onError: UpdateCheckErrorHandler,
    onSettled: UpdateCheckSettledHandler
  ): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('Update check coordinator disposed'));
    if (this.current) return this.current;

    const controller = new AbortController();
    this.activeController = controller;

    const current = this.runWithDeadline(operation, controller)
      .catch((error: unknown) => {
        if (!this.disposed) onError(error);
        throw error;
      })
      .finally(() => {
        if (this.current === current) {
          this.current = null;
          this.activeController = null;
          if (!this.disposed) onSettled();
        }
      });

    this.current = current;
    return current;
  }

  dispose(): void {
    this.disposed = true;
    this.activeController?.abort(new Error('Update service disposed'));
    this.activeController = null;
  }

  private async runWithDeadline(
    operation: UpdateCheckOperation<T>,
    controller: AbortController
  ): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let removeAbortListener = () => {};
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        const error = new UpdateCheckTimeoutError(this.timeoutMs);
        reject(error);
        controller.abort(error);
      }, this.timeoutMs);
    });
    const abortPromise = new Promise<never>((_, reject) => {
      const onAbort = () => {
        reject(
          controller.signal.reason instanceof Error
            ? controller.signal.reason
            : new Error('Update check was cancelled')
        );
      };
      controller.signal.addEventListener('abort', onAbort, { once: true });
      removeAbortListener = () => controller.signal.removeEventListener('abort', onAbort);
    });

    try {
      return await Promise.race([operation(controller.signal), timeoutPromise, abortPromise]);
    } finally {
      if (timeout) clearTimeout(timeout);
      removeAbortListener();
    }
  }
}
