import { useState } from 'react';
import { twilio } from '@shared/twilio-rest';
import type { IncomingPhoneNumber } from '@shared/twilio-rest';
import type { Settings } from '@shared/types';
import type { SetupInput } from './ProvisioningWizard';
import { track } from '@shared/telemetry';

const REPO_URL = 'https://github.com/Mohammad2460/twilio-dialpad';

interface Props {
  initial?: Settings;
  onSubmit: (inp: SetupInput) => void;
}

export function SetupForm({ initial, onSubmit }: Props) {
  const [accountSid, setAccountSid] = useState(initial?.accountSid ?? '');
  const [authToken, setAuthToken] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  // Marketing email is a separate choice and starts off.
  const [marketing, setMarketing] = useState(false);
  const [numbers, setNumbers] = useState<IncomingPhoneNumber[]>([]);
  const [selectedNumber, setSelectedNumber] = useState<IncomingPhoneNumber | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sidOk = /^AC[a-zA-Z0-9]{32}$/.test(accountSid);
  const tokenOk = authToken.length >= 30;
  const nameOk = name.trim().length >= 2;
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  // Twilio Client identity is a technical routing string (no spaces, must start
  // with a letter). Derive it from the person's name; fall back to 'dialpad'.
  const clientIdentity = (() => {
    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
    return /^[a-z][a-z0-9_-]*$/.test(slug) ? slug : 'dialpad';
  })();

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
      name: name.trim(),
      email: email.trim(),
      marketingConsent: marketing,
    });
  }

  const canLoadNumbers = sidOk && tokenOk && !loading;
  const canSubmit = sidOk && tokenOk && nameOk && emailOk && !!selectedNumber && !loading;

  return (
    <div className="mx-auto max-w-xl p-8">
      <h1 className="text-2xl font-semibold">Connect your Twilio account</h1>
      <p className="mt-1 text-sm text-gray-600">
        Two values from your Twilio Console and you can call from Chrome. Setup takes a few seconds.
      </p>

      {!initial && <TwilioGuide />}

      <div className="mt-6 space-y-4 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <Field label="Account SID" required>
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

        <Field label="Auth Token" required>
          <input
            type="password"
            value={authToken}
            onChange={(e) => { setAuthToken(e.target.value.trim()); setNumbers([]); setSelectedNumber(null); }}
            placeholder="From the Twilio Console"
            autoComplete="off"
          />
          <Hint>Used once to connect your account, then discarded. It is never stored.</Hint>
        </Field>

        <Field label="Email" required>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value.trim())}
            placeholder="you@example.com"
            autoComplete="email"
          />
          {email && !emailOk ? (
            <Hint error>Enter a valid email.</Hint>
          ) : (
            <Hint>For your account and service messages only.</Hint>
          )}
        </Field>

        <Field label="Your name" required>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Alex Rivera"
            autoComplete="name"
          />
          {name && !nameOk && <Hint error>Enter your name.</Hint>}
        </Field>

        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="checkbox"
            checked={marketing}
            onChange={(e) => setMarketing(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600"
          />
          <span className="text-sm text-gray-700">
            Also send me product tips and news. <span className="text-gray-500">Optional — unsubscribe any time.</span>
          </span>
        </label>

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

      <TrustNotes />
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-gray-700">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
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

/** For people who arrive without a Twilio account: the three steps, with the real costs. */
function TwilioGuide() {
  return (
    <details
      className="group mt-4 rounded-lg border border-brand-200 bg-brand-50"
      onToggle={(e) => {
        if ((e.target as HTMLDetailsElement).open) track('twilio_guide_opened');
      }}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-brand-800">
        No Twilio account yet? Get one in about 3 minutes
        <span className="text-brand-600 transition-transform duration-200 group-open:rotate-180" aria-hidden="true">
          ▾
        </span>
      </summary>
      <div className="border-t border-brand-200 bg-white px-4 py-4">
        <ol className="space-y-3">
          <GuideStep n={1} title="Create a Twilio account">
            <Ext href="https://www.twilio.com/try-twilio">Sign up at twilio.com</Ext> — free to start, with trial
            credit.
          </GuideStep>
          <GuideStep n={2} title="Get a phone number">
            In the Twilio Console, <Ext href="https://console.twilio.com/us1/develop/phone-numbers/manage/search">buy a number</Ext>{' '}
            with Voice enabled. This becomes your caller ID.
          </GuideStep>
          <GuideStep n={3} title="Copy your Account SID and Auth Token">
            Both are on the <Ext href="https://console.twilio.com/">Console home page</Ext> under “Account Info”. Paste
            them below.
          </GuideStep>
        </ol>
        <div className="mt-4 space-y-1 rounded-md bg-gray-50 px-3 py-2 text-xs leading-relaxed text-gray-600">
          <p>
            <span className="font-medium text-gray-900">What it costs:</span> Twilio bills you directly — about $1.15 a
            month for a US number and about 1.4¢ a minute for US calls. We charge nothing per call.{' '}
            <Ext href="https://www.twilio.com/en-us/voice/pricing/us">Twilio pricing</Ext>
          </p>
          <p>
            <span className="font-medium text-gray-900">Good to know:</span> a Twilio trial account can only call numbers
            you have verified with Twilio. Add a payment method in Twilio to call anyone.
          </p>
        </div>
      </div>
    </details>
  );
}

function GuideStep({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[11px] font-semibold text-brand-700">
        {n}
      </span>
      <div>
        <p className="text-sm font-medium text-gray-900">{title}</p>
        <p className="mt-0.5 text-sm text-gray-600">{children}</p>
      </div>
    </li>
  );
}

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="font-medium text-brand-700 underline decoration-brand-300 underline-offset-2 hover:text-brand-800"
    >
      {children}
    </a>
  );
}

/** What happens to the credentials — stated exactly, because this is where people leave. */
function TrustNotes() {
  return (
    <ul className="mt-4 space-y-1.5 text-xs leading-relaxed text-gray-600">
      <li>
        <span className="font-medium text-gray-900">Your Auth Token is never stored.</span> It is sent over HTTPS, used
        once to check the account is yours and connect your number, then discarded.
      </li>
      <li>
        <span className="font-medium text-gray-900">You stay in control.</span> Setup creates a separate API key in your
        Twilio account for placing calls. We keep it encrypted, and you can delete it in the Twilio Console at any time
        to cut off access.
      </li>
      <li>
        <span className="font-medium text-gray-900">The code is public.</span>{' '}
        <Ext href={REPO_URL}>Read it on GitHub</Ext>.
      </li>
    </ul>
  );
}
