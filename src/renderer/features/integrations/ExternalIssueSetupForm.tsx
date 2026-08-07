import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Input } from '@renderer/lib/ui/input';

export type ExternalIssueSetupField = {
  id: string;
  value: string;
  type?: 'text' | 'password';
  placeholderKey: string;
  autoFocus?: boolean;
};

type Props = {
  provider: 'asana' | 'monday' | 'trello' | 'plane' | 'notion';
  fields: ExternalIssueSetupField[];
  onChange: (id: string, value: string) => void;
  error?: string | null;
};

export function ExternalIssueSetupForm({ provider, fields, onChange, error }: Props) {
  const { t } = useTranslation();

  return (
    <div className="grid gap-2">
      {fields.map((field) => (
        <Input
          key={field.id}
          type={field.type ?? 'text'}
          placeholder={t(field.placeholderKey)}
          value={field.value}
          onChange={(event) => onChange(field.id, event.target.value)}
          className="h-9 w-full"
          aria-label={t(field.placeholderKey)}
          autoFocus={field.autoFocus}
        />
      ))}
      <div className="rounded-md border border-dashed border-border/70 bg-muted/40 p-2">
        <div className="flex items-start gap-2">
          <Info className="mt-0.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <div className="text-xs leading-snug text-muted-foreground">
            <p className="font-medium text-foreground">
              {t(`integrations.setup.${provider}.title`)}
            </p>
            <p className="mt-1">{t(`integrations.setup.${provider}.help`)}</p>
          </div>
        </div>
      </div>
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
