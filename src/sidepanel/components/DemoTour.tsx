import { useEffect, useRef, useState } from 'react';
import { track } from '@shared/telemetry';
import {
  DEMO_CONTACT,
  DEMO_NOTES,
  DEMO_QUESTIONS,
  DEMO_TRANSCRIPT,
  type DemoLine,
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

      {/* Keyed by step so each one rises in as a whole. */}
      <main key={step} className="min-h-0 flex-1 animate-rise-in overflow-y-auto">
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
// Rings, connects, then the transcript arrives word by word the way a live one
// does. When the call ends, the phrases the notes are built from are marked in
// the transcript before the notes appear — the notes visibly come from the call.

const RING_MS = 1300;
const WORD_MS = 62;
const LINE_GAP_MS = 360;
const MARK_STAGGER_MS = 260;
const TO_NOTES_MS = 2600;

type CallPhase = 'ringing' | 'live' | 'ended';

const WORDS = DEMO_TRANSCRIPT.map((l) => l.text.split(' '));

function CallStep({ onDone }: { onDone: () => void }) {
  const instant = prefersReducedMotion();
  const [phase, setPhase] = useState<CallPhase>(instant ? 'ended' : 'ringing');
  // The line being spoken and how many of its words have arrived.
  const [pos, setPos] = useState({ line: 0, word: 0 });
  const [elapsed, setElapsed] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    if (phase !== 'ringing') return;
    const id = window.setTimeout(() => setPhase('live'), RING_MS);
    return () => clearTimeout(id);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'live') return;
    const lineDone = pos.word >= WORDS[pos.line].length;
    const last = pos.line === WORDS.length - 1;
    const id = window.setTimeout(
      () => {
        if (!lineDone) setPos({ line: pos.line, word: pos.word + 1 });
        else if (last) setPhase('ended');
        else setPos({ line: pos.line + 1, word: 0 });
      },
      lineDone ? LINE_GAP_MS : WORD_MS,
    );
    return () => clearTimeout(id);
  }, [phase, pos]);

  useEffect(() => {
    if (phase !== 'live') return;
    const id = window.setInterval(() => setElapsed((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [phase]);

  // Once the phrases are marked, move on by itself — it plays like one clip.
  useEffect(() => {
    if (phase !== 'ended' || instant) return;
    const id = window.setTimeout(() => doneRef.current(), TO_NOTES_MS);
    return () => clearTimeout(id);
  }, [phase, instant]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [pos, phase]);

  const ended = phase === 'ended';
  const speaking = phase === 'live' ? DEMO_TRANSCRIPT[pos.line].speaker : null;
  const visible = ended ? DEMO_TRANSCRIPT.length : phase === 'live' ? pos.line + 1 : 0;
  let markIndex = 0;

  return (
    <div className="flex h-full flex-col px-4 py-4">
      <div className="flex items-center gap-3">
        <div className="relative flex h-11 w-11 shrink-0 items-center justify-center">
          {phase === 'ringing' && <span className="absolute inset-0 animate-ring-out rounded-full bg-brand-400" />}
          <span className="relative flex h-11 w-11 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-800">
            DW
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-gray-900">{DEMO_CONTACT.name}</h2>
          <p className="truncate text-xs text-gray-500">{DEMO_CONTACT.company}</p>
        </div>
        <div className="text-right">
          <p className="text-sm tabular-nums text-gray-900">
            {phase === 'ringing' ? 'Calling…' : `0:${String(elapsed).padStart(2, '0')}`}
          </p>
          <p className="flex items-center justify-end gap-1 text-[11px] text-gray-500">
            {phase === 'live' && <LevelMeter active={speaking} />}
            {phase === 'ringing' ? 'Outgoing' : ended ? 'Call ended' : speaking === 'user' ? 'You' : 'Dana'}
          </p>
        </div>
      </div>

      <div className="mt-3 flex min-h-0 flex-1 flex-col rounded-lg border border-gray-200 bg-gray-50">
        <div className="flex items-center justify-between px-3 py-2 text-xs font-medium text-gray-700">
          <span className="flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              {phase === 'live' && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
              )}
              <span className={`relative inline-flex h-2 w-2 rounded-full ${phase === 'live' ? 'bg-red-500' : 'bg-gray-400'}`} />
            </span>
            {ended ? 'Transcript' : 'Live transcript'}
          </span>
          {ended && <span className="animate-rise-in text-[11px] font-medium text-brand-700">Finding what was promised…</span>}
        </div>
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 space-y-2 overflow-y-auto border-t border-gray-200 bg-white px-3 py-2.5 text-xs"
        >
          {phase === 'ringing' && <p className="italic text-gray-400">Waiting for the call to connect…</p>}
          {DEMO_TRANSCRIPT.slice(0, visible).map((line, i) => {
            const current = phase === 'live' && i === pos.line;
            const delay = line.mark ? markIndex++ * MARK_STAGGER_MS + 200 : 0;
            return (
              <div key={i} className="flex animate-rise-in gap-1.5">
                <span
                  className={[
                    'h-fit shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider',
                    line.speaker === 'user' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600',
                  ].join(' ')}
                >
                  {line.speaker === 'user' ? 'You' : 'Caller'}
                </span>
                <span className={`flex-1 leading-relaxed transition-colors duration-300 ${current ? 'text-gray-500' : 'text-gray-900'}`}>
                  {current ? WORDS[i].slice(0, pos.word).join(' ') : <Marked line={line} on={ended} delay={delay} />}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <button
        type="button"
        onClick={onDone}
        className={[
          'mt-3 w-full rounded-md px-4 py-2 text-sm font-semibold transition-colors duration-200',
          ended ? 'bg-brand-600 text-white hover:bg-brand-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
        ].join(' ')}
      >
        {ended ? 'See the notes' : 'Skip to the notes'}
      </button>
    </div>
  );
}

/** Three bars that move while someone is speaking — green for you, gray for the caller. */
function LevelMeter({ active }: { active: 'user' | 'remote' | null }) {
  return (
    <span className="flex h-3 items-end gap-px" aria-hidden="true">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className={`h-3 w-0.5 origin-bottom animate-level rounded-full ${active === 'user' ? 'bg-green-500' : 'bg-gray-400'}`}
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}

/** A transcript line with its key phrase highlighted once the call has ended. */
function Marked({ line, on, delay }: { line: DemoLine; on: boolean; delay: number }) {
  const at = line.mark ? line.text.indexOf(line.mark) : -1;
  if (!on || !line.mark || at < 0) return <>{line.text}</>;
  return (
    <>
      {line.text.slice(0, at)}
      <mark
        className="animate-mark-in rounded-sm bg-transparent bg-gradient-to-r from-brand-100 to-brand-100 bg-no-repeat px-0.5 text-gray-900"
        style={{ animationDelay: `${delay}ms` }}
      >
        {line.mark}
      </mark>
      {line.text.slice(at + line.mark.length)}
    </>
  );
}

// ── 2. The notes ──────────────────────────────────────────────────────────────
// A beat of "writing", then the note builds top to bottom as one gesture.

const WRITING_MS = 750;

/** Fade-and-rise for the nth block of a sequence. */
function stagger(n: number): { className: string; style: React.CSSProperties } {
  return { className: 'animate-rise-in', style: { animationDelay: `${n * 40}ms` } };
}

function NotesStep({ onDone }: { onDone: () => void }) {
  const [writing, setWriting] = useState(!prefersReducedMotion());
  const [done, setDone] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!writing) return;
    const id = window.setTimeout(() => setWriting(false), WRITING_MS);
    return () => clearTimeout(id);
  }, [writing]);

  if (writing) {
    return (
      <div className="px-4 py-4" aria-busy="true">
        <div className="rounded-lg border border-brand-100 bg-brand-50/60 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-700">Writing notes…</p>
          <div className="mt-2 animate-pulse space-y-2">
            <div className="h-3 w-11/12 rounded bg-brand-100" />
            <div className="h-3 w-10/12 rounded bg-brand-100" />
            <div className="h-3 w-7/12 rounded bg-brand-100" />
            <div className="mt-4 h-3 w-5/12 rounded bg-brand-100" />
            <div className="h-3 w-8/12 rounded bg-brand-100" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-4">
      <div className="rounded-lg border border-brand-100 bg-brand-50/60 p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-700">AI summary</p>
        <p {...stagger(0)} className="mt-1 animate-rise-in text-sm leading-relaxed text-gray-900">
          {DEMO_NOTES.summary}
        </p>
        <p {...stagger(1)} className="mt-2 animate-rise-in text-sm text-gray-900">
          <span className="font-semibold">Next step: </span>
          {DEMO_NOTES.nextStep}
        </p>

        <div {...stagger(2)}>
          <p className="mt-2 text-[11px] font-semibold text-gray-600">Objections</p>
          <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-sm text-gray-800">
            {DEMO_NOTES.objections.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
        </div>

        <p {...stagger(3)} className="mt-2 animate-rise-in text-[11px] font-semibold text-gray-600">
          Promises
        </p>
        <ul>
          {DEMO_NOTES.promises.map((p, i) => (
            <li
              key={p.id}
              className="flex animate-rise-in items-start gap-2 py-1.5"
              style={{ animationDelay: `${(4 + i) * 40}ms` }}
            >
              <input
                type="checkbox"
                checked={!!done[p.id]}
                onChange={(e) => setDone((d) => ({ ...d, [p.id]: e.target.checked }))}
                aria-label={`Mark done: ${p.text}`}
                className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-gray-300 text-brand-600"
              />
              <span className="min-w-0 flex-1">
                <span
                  className={`block text-sm transition-colors duration-200 ${done[p.id] ? 'text-gray-400 line-through' : 'text-gray-900'}`}
                >
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
        className="mt-3 w-full rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors duration-200 hover:bg-brand-700"
      >
        Ask a question about this call
      </button>
    </div>
  );
}

// ── 3. Ask ────────────────────────────────────────────────────────────────────

const THINK_MS = 450;
const TYPE_MS = 18;
const TYPE_CHARS = 3;

function AskStep() {
  const instant = prefersReducedMotion();
  const [asked, setAsked] = useState<DemoQuestion[]>([]);
  // -1 = thinking; otherwise the number of answer characters shown.
  const [typed, setTyped] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const current = asked[asked.length - 1];
  const typing = !!current && typed < current.a.length;

  useEffect(() => {
    if (!typing) return;
    const id = window.setTimeout(
      () => setTyped((n) => (n < 0 ? 0 : n + TYPE_CHARS)),
      typed < 0 ? THINK_MS : TYPE_MS,
    );
    return () => clearTimeout(id);
  }, [typing, typed]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [asked, typed]);

  function ask(q: DemoQuestion) {
    if (typing) return;
    setAsked((a) => [...a, q]);
    setTyped(instant ? q.a.length : -1);
  }

  const left = DEMO_QUESTIONS.filter((q) => !asked.includes(q));

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {asked.map((item, i) => {
          const isLast = i === asked.length - 1;
          const text = isLast ? item.a.slice(0, Math.max(typed, 0)) : item.a;
          const complete = !isLast || !typing;
          return (
            <div key={item.q} className="space-y-2">
              <div className="ml-auto max-w-[90%] animate-rise-in rounded-lg bg-brand-600 px-3 py-2 text-sm text-white">
                {item.q}
              </div>
              <div
                className="max-w-[90%] animate-rise-in rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-900"
                style={{ animationDelay: '120ms' }}
              >
                {text || <span className="text-gray-400">Thinking…</span>}
                {complete && (
                  <span className="ml-1 inline-block animate-rise-in rounded bg-brand-100 px-1.5 py-0.5 text-[11px] font-medium text-brand-800">
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
            {left.map((q, i) => (
              <button
                key={q.q}
                type="button"
                onClick={() => ask(q)}
                disabled={typing}
                className="block w-full animate-rise-in rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-xs text-gray-700 transition-colors duration-150 hover:border-brand-200 hover:bg-brand-50 disabled:opacity-50"
                style={{ animationDelay: `${i * 40}ms` }}
              >
                {q.q}
              </button>
            ))}
          </div>
        )}

        {asked.length > 0 && !typing && (
          <p className="animate-rise-in pt-1 text-[11px] leading-relaxed text-gray-500">
            These are sample answers. With your own calls, it answers across all of them — who to call back, what keeps
            coming up, what you promised.
          </p>
        )}
      </div>
    </div>
  );
}
