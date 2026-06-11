import { useEffect, useState } from 'react';
import type { Settings } from '@shared/types';
import { storage } from '@shared/storage';
import { registerDevice } from '@shared/cloud';
import { track } from '@shared/telemetry';
import { SetupForm } from './SetupForm';

export interface SetupInput {
  accountSid: string;
  authToken: string; // in-memory only, never written to storage
  clientIdentity: string;
  callerId: string;
  numberSid: string;
  email: string;
  marketing: boolean;
}

interface Props {
  initial?: Settings;
  onDone: (s: Settings) => void;
}

export function ProvisioningWizard({ initial, onDone }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Telemetry: user reached setup. Only count fresh setups (not reconfigures)
  // so the funnel measures first-time activation.
  useEffect(() => {
    if (!initial) track('wizard_started');
  }, [initial]);

  async function runBackendSetup(inp: SetupInput) {
    setError(null);
    setBusy(true);
    try {
      // Single ownership-verified call: backend creates the API key + TwiML app,
      // wires the number, stores the email, and mints this device's secret. No
      // per-user Twilio Function, no 30-60s build. Auth Token used in-memory only.
      await registerDevice({
        accountSid: inp.accountSid,
        authToken: inp.authToken,
        clientIdentity: inp.clientIdentity,
        numberSid: inp.numberSid,
        callerId: inp.callerId,
        email: inp.email,
        marketingConsent: inp.marketing,
        provision: true,
      });
      track('autodeploy_succeeded');

      const settings: Settings = {
        accountSid: inp.accountSid,
        apiKeySid: '', // owned server-side now
        twimlAppSid: '', // owned server-side now
        functionUrl: '', // unused for backend-voice installs
        clientIdentity: inp.clientIdentity,
        defaultCallerId: inp.callerId,
        configuredAt: Date.now(),
        backendVoice: true,
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
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      track('autodeploy_failed', { reason: reason.slice(0, 80) });
      setError(reason);
    } finally {
      setBusy(false);
    }
  }

  if (busy) {
    return (
      <div className="mx-auto max-w-xl p-8">
        <h1 className="text-2xl font-semibold">Connecting your Twilio account…</h1>
        <p className="mt-1 text-sm text-gray-600">This takes just a few seconds.</p>
        <div className="mt-6 flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
          <span className="text-sm text-gray-700">Setting up your dialer…</span>
        </div>
      </div>
    );
  }

  return (
    <div>
      {error && (
        <div className="mx-auto mt-6 max-w-xl px-8">
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
            <p className="font-medium">Setup failed</p>
            <p className="mt-1">{error}</p>
            <p className="mt-1 text-xs">Check your credentials and try again.</p>
          </div>
        </div>
      )}
      <SetupForm
        initial={initial}
        onSubmit={(inp) => {
          // Creds validated (SetupForm verifies against Twilio before calling this).
          track('twilio_creds_submitted', { reconfigure: !!initial });
          void runBackendSetup(inp);
        }}
      />
    </div>
  );
}
