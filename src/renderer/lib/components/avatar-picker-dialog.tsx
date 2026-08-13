import { Bot, Check, Copy, ImageUp, Loader2, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import {
  Dialog,
  DialogContent,
  DialogContentArea,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { Textarea } from '@renderer/lib/ui/textarea';
import { cn } from '@renderer/utils/utils';
import { AVATAR_PRESETS } from './avatar-presets';
import { AvatarValue } from './avatar-value';

export function AvatarPickerDialog({
  open,
  onOpenChange,
  name,
  value,
  uploadTitle,
  clearTitle,
  disabled,
  reading,
  onUpload,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  value: string;
  uploadTitle: string;
  clearTitle: string;
  disabled: boolean;
  reading: boolean;
  onUpload: () => void;
  onSelect: (value: string) => void;
}) {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState('');

  useEffect(() => {
    if (!open) {
      setGenerationError('');
      setGenerating(false);
    }
  }, [open]);

  const select = (nextValue: string) => {
    onSelect(nextValue);
    onOpenChange(false);
  };

  const generate = async () => {
    const description = prompt.trim();
    if (!description || generating) return;
    setGenerating(true);
    setGenerationError('');
    try {
      const result = await rpc.llm.generateImage({ prompt: description });
      select(result.imageDataUrl);
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : String(error));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(34rem,calc(100vw-2rem))] sm:max-w-[34rem]">
        <DialogHeader className="min-w-0 items-center gap-3">
          <AvatarValue name={name} value={value} className="size-11 rounded-xl text-base" />
          <div className="min-w-0">
            <DialogTitle className="text-sm font-semibold tracking-normal text-foreground normal-case">
              {t('common.chooseAvatar')}
            </DialogTitle>
            <DialogDescription className="mt-0.5 text-xs">
              {t('common.avatarPickerDescription')}
            </DialogDescription>
          </div>
        </DialogHeader>

        <DialogContentArea className="gap-5 pt-0">
          <section className="space-y-2.5">
            <h3 className="text-xs font-medium text-foreground-muted">
              {t('common.presetAvatars')}
            </h3>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
              {AVATAR_PRESETS.map((preset, index) => {
                const selected = value === preset.value;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    aria-label={`${t('common.presetAvatars')} ${index + 1}`}
                    aria-pressed={selected}
                    disabled={disabled || reading || generating}
                    onClick={() => select(preset.value)}
                    className={cn(
                      'relative aspect-square overflow-hidden rounded-xl border bg-background-1 p-0.5 outline-none transition-[border-color,transform,box-shadow] hover:-translate-y-0.5 hover:border-border-1 focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
                      selected && 'border-primary ring-2 ring-primary/20'
                    )}
                  >
                    <img
                      src={preset.value}
                      alt=""
                      draggable={false}
                      className="size-full rounded-[10px] object-cover"
                    />
                    {selected && (
                      <span className="absolute right-1 bottom-1 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
                        <Check className="size-2.5" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="grid gap-2 rounded-xl border border-border/70 bg-background-1 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <ImageUp className="size-4 text-foreground-muted" />
                {uploadTitle}
              </div>
              <p className="mt-1 text-xs text-foreground-passive">{t('common.avatarUploadHint')}</p>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={disabled || reading || generating}
              onClick={onUpload}
            >
              {reading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ImageUp className="size-4" />
              )}
              {uploadTitle}
            </Button>
          </section>

          <section className="space-y-3 rounded-xl border border-border/70 bg-background p-3">
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Sparkles className="size-4" />
              </span>
              <div className="min-w-0">
                <h3 className="text-sm font-medium text-foreground">
                  {t('common.generateAvatar')}
                </h3>
                <p className="mt-0.5 text-xs leading-relaxed text-foreground-passive">
                  {t('common.generateAvatarDescription')}
                </p>
              </div>
            </div>
            <Textarea
              value={prompt}
              maxLength={800}
              rows={2}
              disabled={disabled || generating}
              placeholder={t('common.avatarPromptPlaceholder')}
              onChange={(event) => setPrompt(event.target.value)}
              className="min-h-16 resize-none text-sm"
            />
            {generationError && (
              <div className="flex items-start justify-between gap-2 rounded-lg border border-border-destructive bg-background-destructive px-2.5 py-2 text-xs text-foreground-destructive">
                <span className="min-w-0 break-words">{generationError}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  title={t('common.copyError')}
                  aria-label={t('common.copyError')}
                  onClick={() => void rpc.app.clipboardWriteText(generationError)}
                >
                  <Copy className="size-3.5" />
                </Button>
              </div>
            )}
            <Button
              type="button"
              className="w-full"
              disabled={disabled || generating || !prompt.trim()}
              onClick={() => void generate()}
            >
              {generating ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Bot className="size-4" />
              )}
              {generating ? t('common.avatarGenerating') : t('common.avatarGenerate')}
            </Button>
          </section>

          {value.trim() && (
            <Button
              type="button"
              variant="ghost"
              className="self-start text-foreground-muted hover:text-foreground-destructive"
              disabled={disabled || reading || generating}
              onClick={() => select('')}
            >
              <Trash2 className="size-4" />
              {clearTitle}
            </Button>
          )}
        </DialogContentArea>
      </DialogContent>
    </Dialog>
  );
}
