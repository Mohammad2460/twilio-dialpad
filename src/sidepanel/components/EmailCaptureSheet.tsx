import { useState } from 'react';
import { ensureCloudAccount, setEmail, verifyEmail } from '@shared/cloud';

interface Props {
  onDone: () => void;
}

type Step = 'capture' | 'verify';

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function EmailCaptureSheet({ onDone }: Props) {
  const [step, setStep] = useState<Step>('capture');
  const [email, setEmailValue] = useState('');
  const [marketing, setMarketing] = useState(false);
  const [code, setCode] = useState('');
  const [submittedEmail, setSubmittedEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chromeEmailHint, setChromeEmailHint] = useState<string | null>(null);

  async function handleSkip() {
    await chrome.storage.local.set({ emailPromptSkipped: true });
    onDone();
  }

  async function handleUseChromeEmail() {
    try {
      // Only called on explicit button click — never auto-read on mount
      const info = await chrome.identity.getProfileUserInfo({
        accountStatus: chrome.identity.AccountStatus.ANY,
      });
      if (info.email) {
        setEmailValue(info.email);
        setChromeEmailHint(null);
      } else {
        setChromeEmailHint('No Chrome account found — please type your email below.');
      }
    } catch {
      setChromeEmailHint('Could not read Chrome profile — please type your email below.');
    }
  }

  async function handleSubmit() {
    setError(null);
    if (!isValidEmail(email)) {
      setError('Please enter a valid email address.');
      return;
    }
    setBusy(true);
    try {
      const account = await ensureCloudAccount();
      const result = await setEmail(account.userId, {
        email: email.trim(),
        productConsent: true,
        marketingConsent: marketing || undefined,
      });
      setSubmittedEmail(email.trim());
      // In dev environments, prefill the code for convenience
      if (result.devCode) {
        setCode(result.devCode);
      }
      setStep('verify');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify() {
    setError(null);
    if (code.trim().length !== 6) {
      setError('Please enter the 6-digit code.');
      return;
    }
    setBusy(true);
    try {
      const account = await ensureCloudAccount();
      await verifyEmail(account.userId, code.trim());
      await chrome.storage.local.set({ emailCaptured: true });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid or expired code. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  // Capture step
  if (step === 'capture') {
    return (
      <div className="rounded-lg border border-brand-200 bg-brand-50 p-4 shadow-sm">
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-gray-900">Stay in the loop</h2>
          <p className="mt-1 text-xs text-gray-600">
            Get weekly call summaries, trial-expiry reminders, and account recovery sent to your inbox.
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700">Email address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmailValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { void handleSubmit(); } }}
              placeholder="you@example.com"
              autoComplete="email"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
            {chromeEmailHint && (
              <p className="mt-1 text-xs text-amber-600">{chromeEmailHint}</p>
            )}
          </div>

          <button
            type="button"
            onClick={() => { void handleUseChromeEmail(); }}
            className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            Use my Chrome account email
          </button>

          <label className="flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              checked={marketing}
              onChange={(e) => setMarketing(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
            />
            <span className="text-xs text-gray-600">
              Also send me product tips &amp; offers (optional)
            </span>
          </label>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => { void handleSubmit(); }}
              disabled={busy}
              className="flex-1 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {busy ? 'Sending…' : 'Continue'}
            </button>
            <button
              type="button"
              onClick={() => { void handleSkip(); }}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              Skip
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Verify step
  return (
    <div className="rounded-lg border border-brand-200 bg-brand-50 p-4 shadow-sm">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-gray-900">Check your inbox</h2>
        <p className="mt-1 text-xs text-gray-600">
          We sent a 6-digit code to <span className="font-medium">{submittedEmail}</span>.
        </p>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-700">Verification code</label>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => { if (e.key === 'Enter') { void handleVerify(); } }}
            placeholder="123456"
            autoComplete="one-time-code"
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono tracking-widest outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          />
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={() => { void handleVerify(); }}
            disabled={busy}
            className="flex-1 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {busy ? 'Verifying…' : 'Verify'}
          </button>
          <button
            type="button"
            onClick={() => { void handleSkip(); }}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}
