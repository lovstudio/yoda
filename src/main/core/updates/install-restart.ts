/**
 * Keep the application alive until shutdown cleanup and the updater's install
 * handoff both finish. Exiting before either promise settles can leave a staged
 * update unapplied and return the UI to the downloaded state.
 */
export async function handoffInstallRestart(
  prepare: () => Promise<void>,
  handoffToUpdater: () => void | Promise<void>
): Promise<void> {
  await prepare();
  await handoffToUpdater();
}
