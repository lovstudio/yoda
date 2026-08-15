import type { ReactNode } from 'react';
import type { ProjectView } from '@renderer/features/projects/stores/project-view';

interface ProjectViewWrapperProps {
  children: ReactNode;
  projectId: string;
  /** Which project page this top-level tab shows (defaults to overview). */
  view?: ProjectView;
}

export function ProjectViewWrapper({ children }: ProjectViewWrapperProps) {
  return <>{children}</>;
}
