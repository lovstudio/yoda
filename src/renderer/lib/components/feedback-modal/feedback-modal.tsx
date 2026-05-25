import { ImageIcon, LogIn, Paperclip, XIcon } from 'lucide-react';
import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAttachments } from '@renderer/lib/hooks/use-attachments';
import { useAccountSession, useAccountSignIn } from '@renderer/lib/hooks/useAccount';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { Spinner } from '@renderer/lib/ui/spinner';
import { Textarea } from '@renderer/lib/ui/textarea';
import { cn } from '@renderer/utils/utils';
import { useFeedbackSubmit, type FeedbackCategory } from './use-feedback-submit';

type FeedbackModalArgs = {
  blurb?: string;
};

type Props = BaseModalProps<void> & FeedbackModalArgs;

function AttachmentThumbnail({
  name,
  previewUrl,
  onRemove,
  disabled,
}: {
  name: string;
  previewUrl: string;
  onRemove: () => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();

  return (
    <div className="group relative size-14 shrink-0 overflow-hidden rounded-md border border-border bg-background">
      <img src={previewUrl} alt={name} className="size-full object-cover" />
      <button
        type="button"
        onClick={onRemove}
        aria-label={t('feedback.removeAttachment', { name })}
        disabled={disabled}
        className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:enabled:opacity-100 disabled:cursor-not-allowed"
      >
        <XIcon className="size-3.5 text-white" />
      </button>
    </div>
  );
}

function SignInGate({ blurb }: { blurb?: string }) {
  const { t } = useTranslation();
  const signIn = useAccountSignIn();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DialogHeader>
        <div className="flex flex-col gap-0.5">
          <DialogTitle>{t('feedback.title')}</DialogTitle>
          {blurb ? <DialogDescription className="text-xs">{blurb}</DialogDescription> : null}
        </div>
      </DialogHeader>
      <DialogContentArea>
        <div className="flex flex-col items-center justify-center gap-3 py-6 text-center">
          <LogIn className="size-8 text-muted-foreground" aria-hidden="true" />
          <div className="space-y-1">
            <p className="text-sm font-medium">{t('feedback.signInTitle')}</p>
            <p className="text-xs text-muted-foreground">{t('feedback.signInDescription')}</p>
          </div>
          <Button
            type="button"
            onClick={() => signIn.mutate(undefined)}
            disabled={signIn.isPending}
            className="gap-2"
          >
            {signIn.isPending ? <Spinner size="sm" /> : <LogIn className="size-4" />}
            <span>
              {signIn.isPending ? t('settings.account.signingIn') : t('settings.account.signIn')}
            </span>
          </Button>
        </div>
      </DialogContentArea>
    </div>
  );
}

export function FeedbackModal({ onSuccess, blurb }: Props) {
  const { t } = useTranslation();
  const { data: session, isLoading: sessionLoading } = useAccountSession();
  const {
    attachments,
    isDraggingOver,
    fileInputRef,
    removeAttachment,
    openFilePicker,
    handleFileInputChange,
    handlePaste,
    handleDrop,
    handleDragOver,
    handleDragEnter,
    handleDragLeave,
    reset: resetAttachments,
  } = useAttachments();

  const {
    feedbackDetails,
    setFeedbackDetails,
    category,
    setCategory,
    submitting,
    errorMessage,
    clearError,
    handleSubmit,
    canSubmit,
  } = useFeedbackSubmit({
    onSuccess: () => {
      resetAttachments();
      onSuccess();
    },
  });

  const handleFormSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      await handleSubmit(attachments.map((attachment) => attachment.file));
    },
    [handleSubmit, attachments]
  );

  if (sessionLoading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center py-8">
        <Spinner size="sm" />
      </div>
    );
  }

  if (!session?.isSignedIn) {
    return <SignInGate blurb={blurb} />;
  }

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
    >
      {isDraggingOver && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-primary/5">
          <div className="flex flex-col items-center gap-1 text-primary">
            <ImageIcon className="size-6" />
            <span className="text-xs font-medium">{t('feedback.dropImageHere')}</span>
          </div>
        </div>
      )}
      <DialogHeader>
        <div className="flex flex-col gap-0.5">
          <DialogTitle>{t('feedback.title')}</DialogTitle>
          {blurb ? (
            <DialogDescription className="text-xs">{blurb}</DialogDescription>
          ) : (
            <DialogDescription className="text-xs">
              {t('feedback.sendingAs', { email: session.user?.email })}
            </DialogDescription>
          )}
        </div>
      </DialogHeader>
      <DialogContentArea>
        <form id="feedback-form" className="space-y-4 pt-0.5" onSubmit={handleFormSubmit}>
          <div className="space-y-1.5">
            <label
              htmlFor="feedback-category"
              className="text-xs font-medium text-muted-foreground"
            >
              {t('feedback.category.label')}
            </label>
            <Select
              value={category}
              onValueChange={(value) => setCategory(value as FeedbackCategory)}
            >
              <SelectTrigger id="feedback-category" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="idea">{t('feedback.category.idea')}</SelectItem>
                <SelectItem value="bug">{t('feedback.category.bug')}</SelectItem>
                <SelectItem value="contact">{t('feedback.category.contact')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="feedback-details" className="sr-only">
              {t('feedback.detailsLabel')}
            </label>
            <Textarea
              id="feedback-details"
              autoFocus
              rows={5}
              placeholder={t('feedback.detailsPlaceholder')}
              className="resize-none"
              value={feedbackDetails}
              onChange={(event) => {
                setFeedbackDetails(event.target.value);
                if (errorMessage) clearError();
              }}
              onPaste={handlePaste}
            />
          </div>

          <div className="space-y-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              multiple
              onChange={handleFileInputChange}
              disabled={submitting}
            />
            {attachments.length > 0 ? (
              <div
                className={cn(
                  'flex flex-wrap gap-2 rounded-md border border-dashed border-border p-2',
                  submitting && 'opacity-50'
                )}
              >
                {attachments.map((attachment, index) => (
                  <AttachmentThumbnail
                    key={attachment.id}
                    name={attachment.file.name}
                    previewUrl={attachment.previewUrl}
                    onRemove={() => removeAttachment(index)}
                    disabled={submitting}
                  />
                ))}
              </div>
            ) : null}
          </div>

          {errorMessage ? (
            <p className="text-sm text-destructive" role="alert">
              {errorMessage}
            </p>
          ) : null}
        </form>
      </DialogContentArea>
      <DialogFooter className="sm:justify-between">
        <Button
          type="button"
          variant="outline"
          onClick={openFilePicker}
          className="gap-2"
          disabled={submitting}
        >
          <Paperclip className="h-4 w-4" aria-hidden="true" />
          <span>{t('feedback.attachImage')}</span>
        </Button>
        <ConfirmButton
          type="submit"
          form="feedback-form"
          className="gap-2 px-4"
          disabled={!canSubmit}
          aria-busy={submitting}
        >
          {submitting ? (
            <>
              <Spinner size="sm" />
              <span>{t('feedback.sending')}</span>
            </>
          ) : (
            <span>{t('feedback.send')}</span>
          )}
        </ConfirmButton>
      </DialogFooter>
    </div>
  );
}
