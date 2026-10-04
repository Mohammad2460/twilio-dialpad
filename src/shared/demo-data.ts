/**
 * Sample data for the try-before-setup demo tour. Everything here is invented:
 * no real person, company or number. The tour never calls the backend, so the
 * "AI" answers are written out here and shown as samples.
 */

export interface DemoLine {
  speaker: 'user' | 'remote';
  text: string;
  /** A phrase inside `text` that the notes are built from; highlighted when the call ends. */
  mark?: string;
}

export const DEMO_CONTACT = { name: 'Dana Whitfield', company: 'Northwind Logistics' };

export const DEMO_TRANSCRIPT: DemoLine[] = [
  { speaker: 'user', text: 'Hi Dana, it’s Sam. Did you get a chance to look at the proposal?' },
  { speaker: 'remote', text: 'I did. The per-seat price works for us.' },
  { speaker: 'remote', text: 'But finance has to sign off, and they want the annual terms in writing.', mark: 'annual terms in writing' },
  { speaker: 'user', text: 'No problem. I’ll send the annual pricing sheet today.', mark: 'send the annual pricing sheet today' },
  { speaker: 'remote', text: 'Good. If I have it by Thursday I can get approval before the 15th.' },
  { speaker: 'user', text: 'You’ll have it this afternoon. Can I call you Friday to confirm?' },
  { speaker: 'remote', text: 'Friday works. Call me after ten.', mark: 'Call me after ten' },
];

export interface DemoPromise {
  id: string;
  text: string;
  /** 'me' = the dialer user promised it; 'them' = the other party did. */
  who: 'me' | 'them';
  due: string;
}

export const DEMO_NOTES = {
  summary:
    'Dana is happy with the per-seat price. The deal now depends on finance, who want the annual terms in writing before they approve.',
  nextStep: 'Send the annual pricing sheet today, then call Friday after 10.',
  objections: ['Finance has to sign off', 'Wants annual terms in writing'],
  promises: [
    { id: 'p1', text: 'Send the annual pricing sheet', who: 'me', due: 'due today' },
    { id: 'p2', text: 'Call back to confirm', who: 'me', due: 'Friday after 10' },
    { id: 'p3', text: 'Get finance approval', who: 'them', due: 'before the 15th' },
  ] satisfies DemoPromise[],
};

export interface DemoQuestion {
  q: string;
  a: string;
}

export const DEMO_QUESTIONS: DemoQuestion[] = [
  {
    q: 'What’s blocking this deal?',
    a: 'Finance sign-off. Dana likes the per-seat price, but finance wants the annual terms in writing before the 15th.',
  },
  {
    q: 'What did I promise?',
    a: 'Two things: send the annual pricing sheet today, and call Dana back on Friday after 10.',
  },
  {
    q: 'Who should I call back this week?',
    a: 'Dana Whitfield, Friday after 10. She is waiting on the pricing sheet first.',
  },
];
