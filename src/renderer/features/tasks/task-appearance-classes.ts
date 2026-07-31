import type { TaskIdleOpacity, TaskTitleStyle } from '@shared/task-appearance';

const TASK_TITLE_STYLE_CLASS_NAMES: Record<TaskTitleStyle, string> = {
  regular: 'font-normal not-italic',
  medium: 'font-medium not-italic',
  italic: 'font-normal italic',
};

const TASK_IDLE_OPACITY_CLASS_NAMES: Record<TaskIdleOpacity, string | undefined> = {
  100: undefined,
  85: 'opacity-[0.85]',
  70: 'opacity-70',
  55: 'opacity-[0.55]',
};

export function taskTitleStyleClassName(style: TaskTitleStyle): string {
  return TASK_TITLE_STYLE_CLASS_NAMES[style];
}

export function taskIdleOpacityClassName(opacity: TaskIdleOpacity): string | undefined {
  return TASK_IDLE_OPACITY_CLASS_NAMES[opacity];
}
