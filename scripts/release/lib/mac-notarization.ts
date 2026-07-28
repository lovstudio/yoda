export function shouldNotarizeMacBuild(): boolean {
  if (process.env.YODA_DISABLE_MAC_SIGNING === '1') return false;

  const hasAppleIdCredentials = hasValues([
    process.env.APPLE_ID,
    process.env.APPLE_APP_SPECIFIC_PASSWORD,
    process.env.APPLE_TEAM_ID,
  ]);
  const hasApiKeyCredentials = hasValues([
    process.env.APPLE_API_KEY,
    process.env.APPLE_API_KEY_ID,
    process.env.APPLE_API_ISSUER,
  ]);

  return hasAppleIdCredentials || hasApiKeyCredentials;
}

function hasValues(values: Array<string | undefined>): boolean {
  return values.every((value) => Boolean(value?.trim()));
}
