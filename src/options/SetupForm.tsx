import { useState } from 'react';
import { twilio } from '@shared/twilio-rest';
import type { IncomingPhoneNumber } from '@shared/twilio-rest';
import type { Settings } from '@shared/types';
import type { SetupInput } from './ProvisioningWizard';

interface Props {
  initial?: Settings;
  onSubmit: (inp: SetupInput) => void;
}

export function SetupForm({ initial, onSubmit }: Props) {
  const [accountSid, setAccountSid] = useState(initial?.accountSid ?? '');
  const [authToken, setAuthToken] = useState('');
  const [clientIdentity, setClientIdentity] = useState(initial?.clientIdentity ?? 'dialpad');
  const [email, setEmail] = useState('');
  const [marketing, setMarketing] = useState(false);
  const [numbers, setNumbers] = useState<IncomingPhoneNumber[]>([]);
  const [selectedNumber, setSelectedNumber] = useState<IncomingPhoneNumber | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sidOk = /^AC[a-zA-Z0-9]{32}$/.test(accountSid);
  const tokenOk = authToken.length >= 30;
  const identityOk = /^[a-zA-Z][a-zA-Z0-9_-]{0,120}$/.test(clientIdentity);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  async function loadNumbers() {
    if (!sidOk || !tokenOk) return;
    setError(null);
    setLoading(true);
    setNumbers([]);
    setSelectedNumber(null);
    try {
      await twilio.verifyAccount(accountSid, authToken);
      const nums = await twilio.listPhoneNumbers(accountSid, authToken);
      if (nums.length === 0) throw new Error('No Twilio phone numbers found. Buy at least one in the Twilio Console.');
      setNumbers(nums);
      setSelectedNumber(nums[0]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function submit() {
    if (!selectedNumber) return;
    onSubmit({
      accountSid,
      authToken,
      clientIdentity,
      callerId: selectedNumber.phone_number,
      numberSid: selectedNumber.sid,
      email: email.trim(),
      marketing,
    });
  }

  const canLoadNumbers = sidOk && tokenOk && !loading;
  const canSubmit = !!selectedNumber && identityOk && emailOk && !loading;

  return (
    <div className="mx-auto max-w-xl p-8">
      <h1 className="text-2xl font-semibold">Twilio Dialpad — Setup</h1>
      <p className="mt-1 text-sm text-gray-600">
        Enter your Twilio credentials. The extension auto-deploys everything — no manual steps.
      </p>

      <div className="mt-6 space-y-4 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <Field label="Account SID">
          <input
            type="text"
            value={accountSid}
            onChange={(e) => { setAccountSid(e.target.value.trim()); setNumbers([]); setSelectedNumber(null); }}
            placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            className="font-mono"
            autoComplete="off"
          />
          {accountSid && !sidOk && <Hint error>Must start with AC and be 34 chars</Hint>}
        </Field>

        <Field label="Auth Token">
          <input
            type="password"
            value={authToken}
            onChange={(e) => { setAuthToken(e.target.value.trim()); setNumbers([]); setSelectedNumber(null); }}
            placeholder="(from Twilio Console — used once, never stored)"
            autoComplete="off"
          />
        </Field>

        <Field label="Email (for trial reminders + account recovery)">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value.trim())}
            placeholder="you@example.com"
            autoComplete="email"
          />
          {email && !emailOk && <Hint error>Enter a valid email.</Hint>}
        </Field>

        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="checkbox"
            checked={marketing}
            onChange={(e) => setMarketing(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-gray-300"
          />
          <span className="text-xs text-gray-600">Also send me product tips &amp; offers (optional)</span>
        </label>

        <Field label="Your name for this device (Twilio Client identity)">
          <input
            type="text"
            value={clientIdentity}
            onChange={(e) => setClientIdentity(e.target.value.trim())}
            placeholder="e.g. work-laptop"
          />
          {clientIdentity && !identityOk && <Hint error>Letters, numbers, _ - only. Start with a letter.</Hint>}
        </Field>

        {numbers.length === 0 && (
          <button
            type="button"
            disabled={!canLoadNumbers}
            onClick={loadNumbers}
            className="w-full rounded-md bg-brand-600 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {loading ? 'Loading numbers…' : 'Load my Twilio numbers'}
          </button>
        )}

        {numbers.length > 0 && (
          <Field label="Twilio phone number to use">
            <select
              value={selectedNumber?.sid ?? ''}
              onChange={(e) => setSelectedNumber(numbers.find((n) => n.sid === e.target.value) ?? null)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono"
            >
              {numbers.map((n) => (
                <option key={n.sid} value={n.sid}>
                  {n.phone_number} — {n.friendly_name}
                </option>
              ))}
            </select>
            <Hint>This number will be your caller ID and receive inbound calls.</Hint>
          </Field>
        )}

        {error && (
          <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}

        {numbers.length > 0 && (
          <button
            type="button"
            disabled={!canSubmit}
            onClick={submit}
            className="w-full rounded-md bg-green-600 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            Set up automatically →
          </button>
        )}
      </div>

      <p className="mt-4 text-xs text-gray-500">
        Your Auth Token is used <strong>once</strong> to provision everything, then discarded. Your Twilio secrets live only in Twilio's servers.
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      <div className="mt-1 [&_input]:w-full [&_input]:rounded-md [&_input]:border [&_input]:border-gray-300 [&_input]:px-3 [&_input]:py-2 [&_input]:text-sm [&_input]:outline-none [&_input:focus]:border-brand-500 [&_input:focus]:ring-1 [&_input:focus]:ring-brand-500">
        {children}
      </div>
    </label>
  );
}

function Hint({ children, error }: { children: React.ReactNode; error?: boolean }) {
  return (
    <p className={['mt-1 text-xs', error ? 'text-red-600' : 'text-gray-500'].join(' ')}>{children}</p>
  );
}
