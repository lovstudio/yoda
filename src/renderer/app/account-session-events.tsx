import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { accountSessionChangedChannel } from '@shared/events/accountEvents';
import { ACCOUNT_COMMERCE_KEY, ACCOUNT_SESSION_KEY } from '@renderer/lib/hooks/useAccount';
import { events } from '@renderer/lib/ipc';

/** Keep every renderer window aligned with account changes discovered in main. */
export function AccountSessionEvents() {
  const queryClient = useQueryClient();

  useEffect(
    () =>
      events.on(accountSessionChangedChannel, () => {
        queryClient.removeQueries({ queryKey: ACCOUNT_COMMERCE_KEY });
        void queryClient.invalidateQueries({ queryKey: [...ACCOUNT_SESSION_KEY] });
        void queryClient.invalidateQueries({ queryKey: ['mobileGateway', 'relayStatus'] });
      }),
    [queryClient]
  );

  return null;
}
