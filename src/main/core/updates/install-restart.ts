export async function handoffInstallRestart(
  prepare: () => Promise<void>,
  quitAndInstall: () => void | Promise<void>
): Promise<void> {
  await prepare();
  await quitAndInstall();
}
