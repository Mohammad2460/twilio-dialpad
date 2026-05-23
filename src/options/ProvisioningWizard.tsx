import { useState } from 'react';
import type { Settings } from '@shared/types';
import { storage } from '@shared/storage';
import { SetupForm } from './SetupForm';
import { AutoSetupProgress } from './AutoSetupProgress';

export interface SetupInput {
  accountSid: string;
  authToken: string; // in-memory only, never written to storage
  clientIdentity: string;
  callerId: string;
  numberSid: string;
}

interface Props {
  initial?: Settings;
  onDone: (s: Settings) => void;
}

export function ProvisioningWizard({ initial, onDone }: Props) {
  const [input, setInput] = useState<SetupInput | null>(null);

  async function finish(
    result: {
      apiKeySid: string;
      twimlAppSid: string;
      functionUrl: string;
      serviceSid?: string;
      environmentSid?: string;
      configSecret?: string;
    },
    inp: SetupInput,
  ) {
    const settings: Settings = {
      accountSid: inp.accountSid,
      apiKeySid: result.apiKeySid,
      twimlAppSid: result.twimlAppSid,
      functionUrl: result.functionUrl,
      clientIdentity: inp.clientIdentity,
      defaultCallerId: inp.callerId,
      configuredAt: Date.now(),
      // New V1.1 fields — populated by autoProvisionAll.
      serviceSid: result.serviceSid,
      environmentSid: result.environmentSid,
      configSecret: result.configSecret,
      // Defaults for incoming routing — extension on, no forwarding.
      incomingEnabled: true,
      forwardEnabled: false,
      forwardNumber: '',
      // Preserve any existing HubSpot config across reconfigure flows.
      hubspotToken: initial?.hubspotToken,
      hubspotPortalId: initial?.hubspotPortalId,
    };
    await storage.setSettings(settings);
    chrome.runtime.sendMessage({ type: 'device.init' }).catch(() => {});
    onDone(settings);
  }

  if (input) {
    return (
      <AutoSetupProgress
        input={input}
        initial={initial}
        onDone={(r) => finish(r, input)}
        onBack={() => setInput(null)}
      />
    );
  }

  return (
    <SetupForm
      initial={initial}
      onSubmit={(inp) => setInput(inp)}
    />
  );
}
