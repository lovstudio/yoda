import { ImagePlus, Loader2, X } from 'lucide-react';
import { useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import { cn } from '@renderer/utils/utils';
import { AvatarPickerDialog } from './avatar-picker-dialog';
import { AvatarValue } from './avatar-value';

export const MAX_AVATAR_IMAGE_BYTES = 2 * 1024 * 1024;

export type AvatarFileError = 'too-large' | 'unsupported' | 'read-failed';

const ACCEPTED_AVATAR_TYPES = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml';

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Avatar image read did not produce a data URL'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read avatar image'));
    reader.readAsDataURL(file);
  });
}

export function AvatarInput({
  id,
  name,
  value,
  onChange,
  inputLabel,
  placeholder,
  uploadTitle,
  clearTitle,
  onFileError,
  disabled = false,
  className,
  previewClassName,
  inputClassName,
  onInputKeyDown,
  appearance = 'field',
}: {
  id: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  inputLabel: string;
  placeholder: string;
  uploadTitle: string;
  clearTitle: string;
  onFileError?: (error: AvatarFileError) => void;
  disabled?: boolean;
  className?: string;
  previewClassName?: string;
  inputClassName?: string;
  onInputKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  appearance?: 'field' | 'profile';
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      onFileError?.('unsupported');
      return;
    }
    if (file.size > MAX_AVATAR_IMAGE_BYTES) {
      onFileError?.('too-large');
      return;
    }
    setReading(true);
    try {
      onChange(await readFileAsDataUrl(file));
      setPickerOpen(false);
    } catch {
      onFileError?.('read-failed');
    } finally {
      setReading(false);
    }
  };

  const fileInput = (
    <input
      ref={inputRef}
      id={appearance === 'profile' ? id : undefined}
      type="file"
      accept={ACCEPTED_AVATAR_TYPES}
      className="hidden"
      tabIndex={-1}
      onChange={(event) => {
        void pickFile(event.currentTarget.files?.[0]);
        event.currentTarget.value = '';
      }}
    />
  );

  const pickerDialog = (
    <AvatarPickerDialog
      open={pickerOpen}
      onOpenChange={setPickerOpen}
      name={name}
      value={value}
      uploadTitle={uploadTitle}
      clearTitle={clearTitle}
      disabled={disabled}
      reading={reading}
      onUpload={() => inputRef.current?.click()}
      onSelect={onChange}
    />
  );

  if (appearance === 'profile') {
    return (
      <div className={cn('shrink-0', className)}>
        {fileInput}
        {pickerDialog}
        <button
          type="button"
          title={uploadTitle}
          aria-label={uploadTitle}
          disabled={disabled || reading}
          onClick={() => setPickerOpen(true)}
          className="group relative block rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60"
        >
          <AvatarValue
            name={name}
            value={value}
            className={cn('size-16 rounded-2xl text-xl', previewClassName)}
          />
          <span className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/0 text-white transition-colors group-hover:bg-black/35 group-focus-visible:bg-black/35">
            {reading ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <ImagePlus className="size-5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
            )}
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className={cn('flex min-w-0 items-center gap-2', className)}>
      <AvatarValue name={name} value={value} className={cn('size-10 text-sm', previewClassName)} />
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <Input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onInputKeyDown}
          aria-label={inputLabel}
          placeholder={placeholder}
          disabled={disabled || reading}
          className={cn('h-8 min-w-0 text-xs', inputClassName)}
        />
        {fileInput}
        {pickerDialog}
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          title={uploadTitle}
          aria-label={uploadTitle}
          disabled={disabled || reading}
          onClick={() => setPickerOpen(true)}
        >
          {reading ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          title={clearTitle}
          aria-label={clearTitle}
          disabled={disabled || reading || !value.trim()}
          onClick={() => onChange('')}
        >
          <X className="size-4" />
        </Button>
      </div>
    </div>
  );
}
