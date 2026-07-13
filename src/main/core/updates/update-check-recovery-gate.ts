type ResetConnections = () => Promise<void>;
type ResetErrorHandler = (error: unknown) => void;

/**
 * Keeps a retry behind both halves of non-macOS updater recovery: closing the
 * updater session and letting electron-updater release its cached check.
 */
export class UpdateCheckRecoveryGate<T> {
  private activeOperation: Promise<T> | null = null;
  private recovery: Promise<void> | null = null;

  track(operation: Promise<T>): Promise<T> {
    this.activeOperation = operation;
    operation.then(
      () => this.clearActiveOperation(operation),
      () => this.clearActiveOperation(operation)
    );
    return operation;
  }

  begin(resetConnections: ResetConnections, onResetError: ResetErrorHandler): void {
    if (this.recovery) return;

    const staleOperation = this.activeOperation;
    const reset = Promise.resolve()
      .then(resetConnections)
      .catch((error: unknown) => onResetError(error));
    const settleStaleOperation = staleOperation
      ? staleOperation.then(
          () => undefined,
          () => undefined
        )
      : Promise.resolve();

    const recovery = Promise.all([reset, settleStaleOperation])
      .then(() => undefined)
      .finally(() => {
        if (this.recovery === recovery) this.recovery = null;
      });
    this.recovery = recovery;
  }

  async wait(): Promise<void> {
    if (this.recovery) await this.recovery;
  }

  private clearActiveOperation(operation: Promise<T>): void {
    if (this.activeOperation === operation) this.activeOperation = null;
  }
}
