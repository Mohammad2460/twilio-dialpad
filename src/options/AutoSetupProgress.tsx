import { useEffect, useState } from 'react';
import { autoProvisionAll, type DeployProgress } from '@shared/twilio-rest';
import type { Settings } from '@shared/types';
import type { SetupInput } from './ProvisioningWizard';

interface Props {
  input: SetupInput;
  initial?: Settings;
  onDone: (r: { apiKeySid: string; twimlAppSid: string; functionUrl: string }) => void;
  onBack: () => void;
}

const STEP_LABELS: Record<string, string> = {
  'api-key': 'Creating API Key…',
  'twiml-app': 'Creating TwiML App…',
  'create-service': 'Creating Serverless service…',
  'upload-functions': 'Uploading Function code…',
  'set-env-vars': 'Configuring environment variables…',
  'build': 'Building Functions (takes ~30s)…',
  'deploy': 'Deploying to production…',
  'wire-number': 'Wiring phone number…',
  'done': 'Done!',
};

const STEP_ORDER = ['api-key', 'twiml-app', 'create-service', 'upload-functions', 'set-env-vars', 'build', 'deploy', 'wire-number', 'done'];

export function AutoSetupProgress({ input, onDone, onBack }: Props) {
  const [steps, setSteps] = useState<string[]>([]);
  const [currentStep, setCurrentStep] = useState<string>('api-key');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;

    autoProvisionAll(
      input.accountSid,
      input.authToken,
      input.clientIdentity,
      input.callerId,
      input.numberSid,
      (p: DeployProgress) => {
        if (cancelled) return;
        setCurrentStep(p.step);
        setSteps((prev) => (prev.includes(p.step) ? prev : [...prev, p.step]));
        if (p.step === 'done') setDone(true);
      },
    ).then((result) => {
      if (!cancelled) onDone(result);
    }).catch((e: unknown) => {
      if (!cancelled) setError(e instanceof Error ? e.message : String(e));
    });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const progressPct = Math.round((STEP_ORDER.indexOf(currentStep) / (STEP_ORDER.length - 1)) * 100);

  return (
    <div className="mx-auto max-w-xl p-8">
      <h1 className="text-2xl font-semibold">Setting up…</h1>
      <p className="mt-1 text-sm text-gray-600">
        Deploying everything to your Twilio account. Takes about 30–60 seconds.
      </p>

      <div className="mt-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-2 rounded-full bg-brand-600 transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        <ul className="space-y-2">
          {STEP_ORDER.filter((s) => s !== 'done').map((s) => {
            const completed = steps.includes(s) && s !== currentStep;
            const active = s === currentStep && !done;
            return (
              <li key={s} className="flex items-center gap-2 text-sm">
                {completed ? (
                  <span className="h-5 w-5 rounded-full bg-green-500 text-center text-xs leading-5 text-white">✓</span>
                ) : active ? (
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
                ) : (
                  <span className="h-5 w-5 rounded-full bg-gray-200" />
                )}
                <span className={active ? 'font-medium text-gray-900' : completed ? 'text-gray-500' : 'text-gray-400'}>
                  {STEP_LABELS[s]}
                </span>
              </li>
            );
          })}
        </ul>

        {done && (
          <div className="mt-4 rounded-md bg-green-50 p-4">
            <p className="font-medium text-green-800">All done! Your dialpad is ready.</p>
            <p className="mt-1 text-sm text-green-700">
              Click the extension icon to open the dialpad in the side panel and make your first call.
            </p>
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
            <p className="font-medium">Setup failed</p>
            <p className="mt-1">{error}</p>
            <button
              type="button"
              onClick={onBack}
              className="mt-2 text-sm text-red-700 underline"
            >
              Go back and try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
