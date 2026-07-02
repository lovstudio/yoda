import { ImagePlus, Loader2, X } from 'lucide-react';
import { useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import { cn } from '@renderer/utils/utils';
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
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);

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
    } catch {
      onFileError?.('read-failed');
    } finally {
      setReading(false);
    }
  };

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
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_AVATAR_TYPES}
          className="hidden"
          tabIndex={-1}
          onChange={(event) => {
            void pickFile(event.currentTarget.files?.[0]);
            event.currentTarget.value = '';
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          title={uploadTitle}
          aria-label={uploadTitle}
          disabled={disabled || reading}
          onClick={() => inputRef.current?.click()}
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
