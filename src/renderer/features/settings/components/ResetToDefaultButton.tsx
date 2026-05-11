import { RotateCcw } from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@renderer/lib/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/lib/ui/tooltip';

interface ResetToDefaultButtonProps {
  /** Optional label shown in the tooltip: "Reset to default: <label>" */
  defaultLabel?: string;
  onReset: () => void;
  disabled?: boolean;
  visible?: boolean;
}

export const ResetToDefaultButton: React.FC<ResetToDefaultButtonProps> = ({
  defaultLabel,
  onReset,
  disabled,
  visible = true,
}) => {
  const { t } = useTranslation();
  if (!visible) {
    return <span aria-hidden="true" className="h-7 w-7 shrink-0" />;
  }

  return (
    <TooltipProvider delay={150}>
      <Tooltip>
        <TooltipTrigger>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={onReset}
            disabled={disabled}
            aria-label={t('settings.keyboard.resetToDefault')}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">
          {defaultLabel !== undefined
            ? t('settings.resetToDefaultWithLabel', { label: defaultLabel })
            : t('settings.keyboard.resetToDefault')}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
