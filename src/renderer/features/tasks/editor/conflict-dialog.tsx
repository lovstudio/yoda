import { Trans, useTranslation } from 'react-i18next';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { useCloseGuard } from '@renderer/lib/modal/use-close-guard';
import { Button } from '@renderer/lib/ui/button';
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';

export type ConflictDialogArgs = {
  filePath: string;
};

type Props = BaseModalProps<boolean> & ConflictDialogArgs;

export function ConflictDialog({ filePath, onSuccess }: Props) {
  const { t } = useTranslation();
  const shortPath = filePath.split('/').slice(-2).join('/');
  useCloseGuard(true);

  return (
    <>
      <DialogHeader showCloseButton={false}>
        <DialogTitle>{t('editor.conflict.title')}</DialogTitle>
        <DialogDescription>
          <Trans
            i18nKey="editor.conflict.description"
            values={{ path: shortPath }}
            components={{
              code: <code className="rounded bg-muted px-1 py-0.5 text-xs" />,
            }}
          />
        </DialogDescription>
      </DialogHeader>
      <DialogFooter className="gap-2">
        <Button variant="outline" onClick={() => onSuccess(false)}>
          {t('editor.conflict.keepMine')}
        </Button>
        <Button onClick={() => onSuccess(true)}>{t('editor.conflict.acceptIncoming')}</Button>
      </DialogFooter>
    </>
  );
}
