import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { rpc } from '@renderer/lib/ipc';
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
import { ExternalIssueSetupForm } from './ExternalIssueSetupForm';
import FeaturebaseSetupForm from './FeaturebaseSetupForm';
import ForgejoSetupForm from './ForgejoSetupForm';
import GitLabSetupForm from './GitLabSetupForm';
import { ISSUE_CONNECTION_STATUS_QUERY_KEY, useIntegrationsContext } from './integrations-provider';
import JiraSetupForm from './JiraSetupForm';
import LinearSetupForm from './LinearSetupForm';
import { NotionSetupForm } from './NotionSetupForm';
import PlainSetupForm from './PlainSetupForm';

type IntegrationType =
  | 'linear'
  | 'jira'
  | 'gitlab'
  | 'plain'
  | 'forgejo'
  | 'featurebase'
  | 'asana'
  | 'monday'
  | 'trello'
  | 'plane'
  | 'notion'
  | 'feishu';

type IntegrationSetupModalArgs = {
  integration: IntegrationType;
};

type Props = BaseModalProps<void> & IntegrationSetupModalArgs;

const descriptions: Record<IntegrationType, { titleKey: string; subtitleKey: string }> = {
  linear: {
    titleKey: 'integrations.setupModal.linear.title',
    subtitleKey: 'integrations.setupModal.linear.subtitle',
  },
  jira: {
    titleKey: 'integrations.setupModal.jira.title',
    subtitleKey: 'integrations.setupModal.jira.subtitle',
  },
  gitlab: {
    titleKey: 'integrations.setupModal.gitlab.title',
    subtitleKey: 'integrations.setupModal.gitlab.subtitle',
  },
  plain: {
    titleKey: 'integrations.setupModal.plain.title',
    subtitleKey: 'integrations.setupModal.plain.subtitle',
  },
  forgejo: {
    titleKey: 'integrations.setupModal.forgejo.title',
    subtitleKey: 'integrations.setupModal.forgejo.subtitle',
  },
  featurebase: {
    titleKey: 'integrations.setupModal.featurebase.title',
    subtitleKey: 'integrations.setupModal.featurebase.subtitle',
  },
  asana: {
    titleKey: 'integrations.setupModal.asana.title',
    subtitleKey: 'integrations.setupModal.asana.subtitle',
  },
  monday: {
    titleKey: 'integrations.setupModal.monday.title',
    subtitleKey: 'integrations.setupModal.monday.subtitle',
  },
  trello: {
    titleKey: 'integrations.setupModal.trello.title',
    subtitleKey: 'integrations.setupModal.trello.subtitle',
  },
  plane: {
    titleKey: 'integrations.setupModal.plane.title',
    subtitleKey: 'integrations.setupModal.plane.subtitle',
  },
  notion: {
    titleKey: 'integrations.setupModal.notion.title',
    subtitleKey: 'integrations.setupModal.notion.subtitle',
  },
  feishu: {
    titleKey: 'integrations.setupModal.feishu.title',
    subtitleKey: 'integrations.setupModal.feishu.subtitle',
  },
};

export function IntegrationSetupModal({ integration, onSuccess, onClose }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const {
    connectLinear,
    connectJira,
    connectGitlab,
    connectPlain,
    connectForgejo,
    connectFeaturebase,
    connectAsana,
    connectMonday,
    connectTrello,
    connectPlane,
    connectNotion,
    isLinearLoading,
    isJiraLoading,
    isGitlabLoading,
    isPlainLoading,
    isForgejoLoading,
    isFeaturebaseLoading,
    isAsanaLoading,
    isMondayLoading,
    isTrelloLoading,
    isPlaneLoading,
    isNotionLoading,
  } = useIntegrationsContext();

  // Linear state
  const [linearKey, setLinearKey] = useState('');

  // Jira state
  const [jiraSite, setJiraSite] = useState('');
  const [jiraEmail, setJiraEmail] = useState('');
  const [jiraToken, setJiraToken] = useState('');

  // GitLab state
  const [gitlabInstanceUrl, setGitlabInstanceUrl] = useState('');
  const [gitlabToken, setGitlabToken] = useState('');

  // Plain state
  const [plainKey, setPlainKey] = useState('');

  // Forgejo state
  const [forgejoInstanceUrl, setForgejoInstanceUrl] = useState('');
  const [forgejoToken, setForgejoToken] = useState('');

  // Featurebase state
  const [featurebaseKey, setFeaturebaseKey] = useState('');

  const [asanaToken, setAsanaToken] = useState('');
  const [mondayToken, setMondayToken] = useState('');
  const [trelloKey, setTrelloKey] = useState('');
  const [trelloToken, setTrelloToken] = useState('');
  const [planeApiBaseUrl, setPlaneApiBaseUrl] = useState('https://api.plane.so');
  const [planeWorkspaceSlug, setPlaneWorkspaceSlug] = useState('');
  const [planeApiKey, setPlaneApiKey] = useState('');
  const [notionToken, setNotionToken] = useState('');
  const [feishuAuthStarted, setFeishuAuthStarted] = useState(false);
  const [feishuLoading, setFeishuLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const isLoading =
    (integration === 'linear' && isLinearLoading) ||
    (integration === 'jira' && isJiraLoading) ||
    (integration === 'gitlab' && isGitlabLoading) ||
    (integration === 'plain' && isPlainLoading) ||
    (integration === 'forgejo' && isForgejoLoading) ||
    (integration === 'featurebase' && isFeaturebaseLoading) ||
    (integration === 'asana' && isAsanaLoading) ||
    (integration === 'monday' && isMondayLoading) ||
    (integration === 'trello' && isTrelloLoading) ||
    (integration === 'plane' && isPlaneLoading) ||
    (integration === 'notion' && isNotionLoading) ||
    (integration === 'feishu' && feishuLoading);

  const canSubmit =
    (integration === 'linear' && !!linearKey.trim()) ||
    (integration === 'jira' && !!(jiraSite.trim() && jiraEmail.trim() && jiraToken.trim())) ||
    (integration === 'gitlab' && !!(gitlabInstanceUrl.trim() && gitlabToken.trim())) ||
    (integration === 'plain' && !!plainKey.trim()) ||
    (integration === 'forgejo' && !!(forgejoInstanceUrl.trim() && forgejoToken.trim())) ||
    (integration === 'featurebase' && !!featurebaseKey.trim()) ||
    (integration === 'asana' && !!asanaToken.trim()) ||
    (integration === 'monday' && !!mondayToken.trim()) ||
    (integration === 'trello' && !!(trelloKey.trim() && trelloToken.trim())) ||
    (integration === 'plane' &&
      !!(planeApiBaseUrl.trim() && planeWorkspaceSlug.trim() && planeApiKey.trim())) ||
    (integration === 'notion' && !!notionToken.trim()) ||
    integration === 'feishu';

  const handleSubmit = useCallback(async () => {
    setError(null);
    try {
      switch (integration) {
        case 'linear':
          await connectLinear(linearKey.trim());
          break;
        case 'jira':
          await connectJira({
            siteUrl: jiraSite.trim(),
            email: jiraEmail.trim(),
            token: jiraToken.trim(),
          });
          break;
        case 'gitlab':
          await connectGitlab({
            instanceUrl: gitlabInstanceUrl.trim(),
            token: gitlabToken.trim(),
          });
          break;
        case 'plain':
          await connectPlain(plainKey.trim());
          break;
        case 'forgejo':
          await connectForgejo({
            instanceUrl: forgejoInstanceUrl.trim(),
            token: forgejoToken.trim(),
          });
          break;
        case 'featurebase':
          await connectFeaturebase(featurebaseKey.trim());
          break;
        case 'asana':
          await connectAsana(asanaToken.trim());
          break;
        case 'monday':
          await connectMonday(mondayToken.trim());
          break;
        case 'trello':
          await connectTrello({ apiKey: trelloKey.trim(), apiToken: trelloToken.trim() });
          break;
        case 'plane':
          await connectPlane({
            apiBaseUrl: planeApiBaseUrl.trim(),
            workspaceSlug: planeWorkspaceSlug.trim(),
            apiKey: planeApiKey.trim(),
          });
          break;
        case 'notion':
          await connectNotion(notionToken.trim());
          break;
        case 'feishu':
          setFeishuLoading(true);
          try {
            if (!feishuAuthStarted) {
              const { verificationUrl } = await rpc.feishu.startAuthorization();
              await rpc.app.openExternal(verificationUrl);
              setFeishuAuthStarted(true);
              return;
            }
            await rpc.feishu.completeAuthorization();
            await queryClient.invalidateQueries({ queryKey: ISSUE_CONNECTION_STATUS_QUERY_KEY });
          } finally {
            setFeishuLoading(false);
          }
          break;
      }
      onSuccess();
    } catch (e) {
      setError((e as Error).message || t('integrations.connectFailed'));
    }
  }, [
    integration,
    linearKey,
    jiraSite,
    jiraEmail,
    jiraToken,
    gitlabInstanceUrl,
    gitlabToken,
    plainKey,
    forgejoInstanceUrl,
    forgejoToken,
    featurebaseKey,
    connectLinear,
    connectJira,
    connectGitlab,
    connectPlain,
    connectForgejo,
    connectFeaturebase,
    asanaToken,
    mondayToken,
    trelloKey,
    trelloToken,
    planeApiBaseUrl,
    planeWorkspaceSlug,
    planeApiKey,
    notionToken,
    connectAsana,
    connectMonday,
    connectTrello,
    connectPlane,
    connectNotion,
    feishuAuthStarted,
    queryClient,
    onSuccess,
    t,
  ]);

  const { titleKey, subtitleKey } = descriptions[integration];

  return (
    <>
      <DialogHeader
        className={integration === 'notion' ? 'flex-col items-start gap-1' : undefined}
        showCloseButton={false}
      >
        <DialogTitle>{t(titleKey)}</DialogTitle>
        <DialogDescription className="text-xs">{t(subtitleKey)}</DialogDescription>
      </DialogHeader>
      <DialogContentArea>
        {integration === 'linear' && (
          <LinearSetupForm apiKey={linearKey} onChange={setLinearKey} error={error} />
        )}
        {integration === 'jira' && (
          <JiraSetupForm
            site={jiraSite}
            email={jiraEmail}
            token={jiraToken}
            onChange={(u) => {
              if (typeof u.site === 'string') setJiraSite(u.site);
              if (typeof u.email === 'string') setJiraEmail(u.email);
              if (typeof u.token === 'string') setJiraToken(u.token);
            }}
            error={error}
          />
        )}
        {integration === 'gitlab' && (
          <GitLabSetupForm
            instanceUrl={gitlabInstanceUrl}
            token={gitlabToken}
            onChange={(u) => {
              if (typeof u.instanceUrl === 'string') setGitlabInstanceUrl(u.instanceUrl);
              if (typeof u.token === 'string') setGitlabToken(u.token);
            }}
            error={error}
          />
        )}
        {integration === 'plain' && (
          <PlainSetupForm apiKey={plainKey} onChange={setPlainKey} error={error} />
        )}
        {integration === 'forgejo' && (
          <ForgejoSetupForm
            instanceUrl={forgejoInstanceUrl}
            token={forgejoToken}
            onChange={(u) => {
              if (typeof u.instanceUrl === 'string') setForgejoInstanceUrl(u.instanceUrl);
              if (typeof u.token === 'string') setForgejoToken(u.token);
            }}
            error={error}
          />
        )}
        {integration === 'featurebase' && (
          <FeaturebaseSetupForm
            apiKey={featurebaseKey}
            onChange={setFeaturebaseKey}
            error={error}
          />
        )}
        {integration === 'asana' && (
          <ExternalIssueSetupForm
            provider="asana"
            fields={[
              {
                id: 'accessToken',
                value: asanaToken,
                type: 'password',
                placeholderKey: 'integrations.setup.asana.tokenPlaceholder',
                autoFocus: true,
              },
            ]}
            onChange={(_, value) => setAsanaToken(value)}
            error={error}
          />
        )}
        {integration === 'monday' && (
          <ExternalIssueSetupForm
            provider="monday"
            fields={[
              {
                id: 'apiToken',
                value: mondayToken,
                type: 'password',
                placeholderKey: 'integrations.setup.monday.tokenPlaceholder',
                autoFocus: true,
              },
            ]}
            onChange={(_, value) => setMondayToken(value)}
            error={error}
          />
        )}
        {integration === 'trello' && (
          <ExternalIssueSetupForm
            provider="trello"
            fields={[
              {
                id: 'apiKey',
                value: trelloKey,
                placeholderKey: 'integrations.setup.trello.keyPlaceholder',
                autoFocus: true,
              },
              {
                id: 'apiToken',
                value: trelloToken,
                type: 'password',
                placeholderKey: 'integrations.setup.trello.tokenPlaceholder',
              },
            ]}
            onChange={(id, value) =>
              id === 'apiKey' ? setTrelloKey(value) : setTrelloToken(value)
            }
            error={error}
          />
        )}
        {integration === 'plane' && (
          <ExternalIssueSetupForm
            provider="plane"
            fields={[
              {
                id: 'apiBaseUrl',
                value: planeApiBaseUrl,
                placeholderKey: 'integrations.setup.plane.urlPlaceholder',
                autoFocus: true,
              },
              {
                id: 'workspaceSlug',
                value: planeWorkspaceSlug,
                placeholderKey: 'integrations.setup.plane.workspacePlaceholder',
              },
              {
                id: 'apiKey',
                value: planeApiKey,
                type: 'password',
                placeholderKey: 'integrations.setup.plane.keyPlaceholder',
              },
            ]}
            onChange={(id, value) => {
              if (id === 'apiBaseUrl') setPlaneApiBaseUrl(value);
              if (id === 'workspaceSlug') setPlaneWorkspaceSlug(value);
              if (id === 'apiKey') setPlaneApiKey(value);
            }}
            error={error}
          />
        )}
        {integration === 'notion' && (
          <NotionSetupForm
            token={notionToken}
            onChange={(value) => {
              setNotionToken(value);
              setError(null);
            }}
            error={error}
          />
        )}
        {integration === 'feishu' && (
          <div className="grid gap-2">
            <ExternalIssueSetupForm
              provider="feishu"
              fields={[]}
              onChange={() => undefined}
              error={error}
            />
            {feishuAuthStarted ? (
              <p className="text-xs text-muted-foreground" role="status">
                {t('integrations.setup.feishu.waiting')}
              </p>
            ) : null}
          </div>
        )}
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <ConfirmButton onClick={() => void handleSubmit()} disabled={!canSubmit || isLoading}>
          {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {integration === 'feishu'
            ? t(
                feishuAuthStarted
                  ? 'integrations.setup.feishu.finishAuthorization'
                  : 'integrations.setup.feishu.startAuthorization'
              )
            : integration === 'notion'
              ? t('integrations.setup.notion.verifyAndConnect')
              : t('integrations.connect')}
        </ConfirmButton>
      </DialogFooter>
    </>
  );
}
