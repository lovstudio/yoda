export type MaasGatewayProviderConfiguration = {
  providerId: string;
  endpoint: string;
  apiKey: string;
};

export type MaasGatewayHostMessage =
  | {
      type: 'start';
      admissionToken: string;
      port: number;
    }
  | {
      type: 'configure';
      requestId: string;
      configuration: MaasGatewayProviderConfiguration;
    }
  | {
      type: 'clear';
      requestId: string;
    }
  | {
      type: 'shutdown';
    };

export type MaasGatewayWorkerMessage =
  | {
      type: 'ready';
      port: number;
    }
  | {
      type: 'configured';
      requestId: string;
      providerId: string | null;
    }
  | {
      type: 'error';
      requestId?: string;
      message: string;
    }
  | {
      type: 'stopped';
    };

export function isMaasGatewayWorkerMessage(value: unknown): value is MaasGatewayWorkerMessage {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    record.type === 'ready' ||
    record.type === 'configured' ||
    record.type === 'error' ||
    record.type === 'stopped'
  );
}
