export async function handoffInstallRestart(
  prepare: () => Promise<void>,
  quitAndInstall: () => void
): Promise<void> {
  await prepare();
  quitAndInstall();
}
