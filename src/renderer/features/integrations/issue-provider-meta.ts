import featurebaseLogo from '@/assets/images/Featurebase.svg';
import forgejoLogo from '@/assets/images/Forgejo.svg';
import githubLogo from '@/assets/images/github.png';
import gitlabLogo from '@/assets/images/GitLab.svg';
import jiraLogo from '@/assets/images/jira.png';
import linearLogo from '@/assets/images/Linear.svg';
import asanaLogo from '@/assets/images/mcp/asana.svg';
import mondayLogo from '@/assets/images/mcp/monday.svg';
import notionLogo from '@/assets/images/mcp/notion.svg';
import planeLogo from '@/assets/images/mcp/plane.svg';
import trelloLogo from '@/assets/images/mcp/trello.svg';
import plainLogo from '@/assets/images/Plain.svg';
import type { IssueProviderType } from '@shared/issue-providers';

export const ISSUE_PROVIDER_ORDER: IssueProviderType[] = [
  'linear',
  'github',
  'jira',
  'gitlab',
  'forgejo',
  'featurebase',
  'plain',
  'asana',
  'monday',
  'trello',
  'plane',
  'notion',
];

export const ISSUE_PROVIDER_META: Record<
  IssueProviderType,
  {
    displayName: string;
    logo: string;
  }
> = {
  linear: { displayName: 'Linear', logo: linearLogo },
  github: { displayName: 'GitHub', logo: githubLogo },
  jira: { displayName: 'Jira', logo: jiraLogo },
  gitlab: { displayName: 'GitLab', logo: gitlabLogo },
  forgejo: { displayName: 'Forgejo', logo: forgejoLogo },
  featurebase: { displayName: 'Featurebase', logo: featurebaseLogo },
  plain: { displayName: 'Plain', logo: plainLogo },
  asana: { displayName: 'Asana', logo: asanaLogo },
  monday: { displayName: 'Monday.com', logo: mondayLogo },
  trello: { displayName: 'Trello', logo: trelloLogo },
  plane: { displayName: 'Plane', logo: planeLogo },
  notion: { displayName: 'Notion', logo: notionLogo },
};
