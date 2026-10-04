import { useEffect, useRef, useState } from 'react';
import { track } from '@shared/telemetry';
import {
  DEMO_CONTACT,
  DEMO_NOTES,
  DEMO_QUESTIONS,
  DEMO_TRANSCRIPT,
  type DemoQuestion,
} from '@shared/demo-data';

type Step = 'call' | 'notes' | 'ask';
const STEPS: Step[] = ['call', 'notes', 'ask'];

const CAPTION: Record<Step, { title: string; body: string }> = {
  call: { title: 'Every call is transcribed as you talk', body: 'Call from Chrome with your own Twilio number. No desk phone, no extra app.' },
  notes: { title: 'The notes write themselves', body: 'Summary, objections and who promised what — seconds after you hang up.' },
  ask: { title: 'Ask about your calls', body: 'Answers come from your own calls and link back to them.' },
};

/** True when the user asked the OS for less motion: the tour then shows each step complete. */
function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function openSetup(from: Step) {
  track('demo_setup_clicked', { step: from });
  chrome.runtime.openOptionsPage();
}

/**
 * Try-before-setup tour, shown before any Twilio details are asked for: a
 * sample call plays, its notes appear, and a question about it is answered.
 * Sample data only — no account, no backend call, nothing stored.
 */
export function DemoTour({ onExit }: { onExit: () => void }) {
  const [step, setStep] = useState<Step>('call');
  const index = STEPS.indexOf(step);

  useEffect(() => {
    track('demo_started');
  }, []);

  function go(next: Step) {
    if (next === 'ask') track('demo_finished');
    setStep(next);
  }

  const caption = CAPTION[step];

  return (
    <div className="flex h-full flex-col bg-white">
      <header className="border-b border-brand-100 bg-gradient-to-b from-brand-50 to-white px-4 pb-3 pt-4">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-700">
            Demo · {index + 1} of {STEPS.length}
          </p>
          <button type="button" onClick={onExit} className="text-[11px] font-medium text-gray-500 hover:text-gray-800">
            Close demo
          </button>
        </div>
        <h1 className="mt-1 text-lg font-semibold leading-snug text-gray-900">{caption.title}</h1>
        <p className="mt-1 text-xs leading-relaxed text-gray-600">{caption.body}</p>
        <div className="mt-3 flex gap-1" aria-hidden="true">
          {STEPS.map((s, i) => (
            <span key={s} className={`h-1 flex-1 rounded-full ${i <= index ? 'bg-brand-600' : 'bg-brand-100'}`} />
          ))}
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        {step === 'call' && <CallStep onDone={() => go('notes')} />}
        {step === 'notes' && <NotesStep onDone={() => go('ask')} />}
        {step === 'ask' && <AskStep />}
      </main>

      <footer className="border-t border-gray-200 bg-white p-3">
        <button
          type="button"
          onClick={() => openSetup(step)}
          className={[
            'w-full rounded-md px-4 py-2 text-sm font-semibold transition',
            step === 'ask'
              ? 'bg-brand-600 text-white hover:bg-brand-700'
              : 'border border-gray-300 text-gray-700 hover:bg-gray-50',
          ].join(' ')}
        >
          {step === 'ask' ? 'Do this with my own calls — set up' : 'Skip the demo — set up now'}
        </button>
        <p className="mt-1.5 text-center text-[11px] text-gray-500">
          Sample call, not a real person. Calling is free and unlimited; 7 days of Pro included, no card.
        </p>
      </footer>
    </div>
  );
}

// ── 1. The call ───────────────────────────────────────────────────────────────

const LINE_MS = 1100;

function CallStep({ onDone }: { onDone: () => void }) {
  const instant = prefersReducedMotion();
  const [shown, setShown] = useState(instant ? DEMO_TRANSCRIPT.length : 0);
  const [elapsed, setElapsed] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const finished = shown >= DEMO_TRANSCRIPT.length;

  useEffect(() => {
    if (finished) return;
    const id = window.setTimeout(() => setShown((n) => n + 1), shown === 0 ? 600 : LINE_MS);
    return () => clearTimeout(id);
  }, [shown, finished]);

  useEffect(() => {
    if (finished) return;
    const id = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [finished]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown]);

  return (
    <div className="flex h-full flex-col px-4 py-4">
      <div className="text-center">
        <p className="text-[11px] uppercase tracking-wide text-gray-500">Outgoing</p>
        <h2 className="mt-1 text-xl font-medium text-gray-900">{DEMO_CONTACT.name}</h2>
        <p className="text-xs text-gray-500">{DEMO_CONTACT.company}</p>
        <p className="mt-1 text-sm tabular-nums text-gray-600">
          {finished ? 'Call ended' : `0:${String(elapsed).padStart(2, '0')}`}
        </p>
      </div>

      <div className="mt-3 flex min-h-0 flex-1 flex-col rounded-lg border border-gray-200 bg-gray-50">
        <div className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-700">
          <span className="relative flex h-2 w-2">
            {!finished && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
            )}
            <span className={`relative inline-flex h-2 w-2 rounded-full ${finished ? 'bg-gray-400' : 'bg-red-500'}`} />
          </span>
          {finished ? 'Transcript' : 'Live transcript'}
        </div>
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 space-y-1.5 overflow-y-auto border-t border-gray-200 bg-white px-3 py-2 text-xs"
          aria-live="polite"
        >
          {shown === 0 && <p className="italic text-gray-400">Listening…</p>}
          {DEMO_TRANSCRIPT.slice(0, shown).map((line, i) => (
            <div key={i} className="flex gap-1.5">
              <span
                className={[
                  'h-fit shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider',
                  line.speaker === 'user' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600',
                ].join(' ')}
              >
                {line.speaker === 'user' ? 'You' : 'Caller'}
              </span>
              <span className="flex-1 leading-relaxed text-gray-900">{line.text}</span>
            </div>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={onDone}
        className={[
          'mt-3 w-full rounded-md px-4 py-2 text-sm font-semibold transition',
          finished ? 'bg-brand-600 text-white hover:bg-brand-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
        ].join(' ')}
      >
        {finished ? 'See the notes' : 'Skip to the notes'}
      </button>
    </div>
  );
}

// ── 2. The notes ──────────────────────────────────────────────────────────────

function NotesStep({ onDone }: { onDone: () => void }) {
  const [done, setDone] = useState<Record<string, boolean>>({});
  return (
    <div className="px-4 py-4">
      <div className="rounded-lg border border-brand-100 bg-brand-50/60 p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-700">AI summary</p>
        <p className="mt-1 text-sm leading-relaxed text-gray-900">{DEMO_NOTES.summary}</p>
        <p className="mt-2 text-sm text-gray-900">
          <span className="font-semibold">Next step: </span>
          {DEMO_NOTES.nextStep}
        </p>

        <p className="mt-2 text-[11px] font-semibold text-gray-600">Objections</p>
        <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-sm text-gray-800">
          {DEMO_NOTES.objections.map((o) => (
            <li key={o}>{o}</li>
          ))}
        </ul>

        <p className="mt-2 text-[11px] font-semibold text-gray-600">Promises</p>
        <ul>
          {DEMO_NOTES.promises.map((p) => (
            <li key={p.id} className="flex items-start gap-2 py-1.5">
              <input
                type="checkbox"
                checked={!!done[p.id]}
                onChange={(e) => setDone((d) => ({ ...d, [p.id]: e.target.checked }))}
                aria-label={`Mark done: ${p.text}`}
                className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-gray-300 text-brand-600"
              />
              <span className="min-w-0 flex-1">
                <span className={`block text-sm ${done[p.id] ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                  {p.text}
                </span>
                <span className="mt-0.5 block text-[11px] text-gray-500">
                  {p.who === 'me' ? 'You → ' : 'Waiting on '}
                  {DEMO_CONTACT.name} · {p.due}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
        Before your next call with {DEMO_CONTACT.name.split(' ')[0]}, these notes show up on the keypad on their own.
      </p>

      <button
        type="button"
        onClick={onDone}
        className="mt-3 w-full rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
      >
        Ask a question about this call
      </button>
    </div>
  );
}

// ── 3. Ask ────────────────────────────────────────────────────────────────────

const TYPE_MS = 18;
const TYPE_CHARS = 3;

function AskStep() {
  const instant = prefersReducedMotion();
  const [asked, setAsked] = useState<DemoQuestion[]>([]);
  const [typed, setTyped] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const current = asked[asked.length - 1];
  const typing = !!current && typed < current.a.length;

  useEffect(() => {
    if (!typing) return;
    const id = window.setTimeout(() => setTyped((n) => n + TYPE_CHARS), TYPE_MS);
    return () => clearTimeout(id);
  }, [typing, typed]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [asked, typed]);

  function ask(q: DemoQuestion) {
    if (typing) return;
    setAsked((a) => [...a, q]);
    setTyped(instant ? q.a.length : 0);
  }

  const left = DEMO_QUESTIONS.filter((q) => !asked.includes(q));

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {asked.map((item, i) => {
          const isLast = i === asked.length - 1;
          const text = isLast ? item.a.slice(0, typed) : item.a;
          const complete = !isLast || !typing;
          return (
            <div key={item.q} className="space-y-2">
              <div className="ml-auto max-w-[90%] rounded-lg bg-brand-600 px-3 py-2 text-sm text-white">{item.q}</div>
              <div className="max-w-[90%] rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-900">
                {text || <span className="text-gray-400">Thinking…</span>}
                {complete && (
                  <span className="mx-0.5 ml-1 inline-block rounded bg-brand-100 px-1.5 py-0.5 text-[11px] font-medium text-brand-800">
                    {DEMO_CONTACT.name} · today
                  </span>
                )}
              </div>
            </div>
          );
        })}

        {left.length > 0 && (
          <div className="space-y-1.5 pt-1">
            {asked.length === 0 && <p className="text-xs text-gray-500">Tap a question:</p>}
            {left.map((q) => (
              <button
                key={q.q}
                type="button"
                onClick={() => ask(q)}
                disabled={typing}
                className="block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-xs text-gray-700 transition hover:border-brand-200 hover:bg-brand-50 disabled:opacity-50"
              >
                {q.q}
              </button>
            ))}
          </div>
        )}

        {asked.length > 0 && !typing && (
          <p className="pt-1 text-[11px] leading-relaxed text-gray-500">
            These are sample answers. With your own calls, it answers across all of them — who to call back, what keeps coming up, what you
            promised.
          </p>
        )}
      </div>
    </div>
  );
}
