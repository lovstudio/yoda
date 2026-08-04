export type AiLabAppBasicInfoFields = {
  appName?: string;
  description?: string;
  appId?: string;
  yodaLink?: string;
  projectId?: string;
  projectPath?: string;
  runtimeKind?: string;
  runtimeName?: string;
  model?: string | null;
  capabilities?: string[];
  startCommand?: string;
};

export type AiLabAppBasicInfoLabels = {
  app: string;
  description: string;
  appId: string;
  yodaLink: string;
  projectId: string;
  projectPath: string;
  runtimeKind: string;
  runtime: string;
  model: string;
  capabilities: string;
  startCommand: string;
};

export function buildAiLabAppBasicInfo(
  fields: AiLabAppBasicInfoFields,
  labels: AiLabAppBasicInfoLabels
): string | undefined {
  const rows: Array<[label: string, value: string | null | undefined]> = [
    [labels.app, fields.appName],
    [labels.description, fields.description],
    [labels.appId, fields.appId],
    [labels.yodaLink, fields.yodaLink],
    [labels.projectId, fields.projectId],
    [labels.projectPath, fields.projectPath],
    [labels.startCommand, fields.startCommand],
    [labels.runtimeKind, fields.runtimeKind],
    [labels.runtime, fields.runtimeName],
    [labels.model, fields.model],
    [labels.capabilities, fields.capabilities?.join(', ')],
  ];

  const parts = rows.flatMap(([label, value]) => {
    const trimmed = value?.trim();
    return trimmed ? [`${label}: ${trimmed}`] : [];
  });

  return parts.length > 0 ? parts.join('\n') : undefined;
}
