import { useCallback, useEffect, useState } from 'react';
import { normalizeE164, formatForDisplay } from '@shared/phone';

export interface PasteSuggestion {
  e164: string;
  formatted: string;
}

/**
 * Reads the clipboard on mount + window focus.
 * If clipboard content parses as a valid phone number, returns a suggestion.
 * User can dismiss; suggestion only re-appears if clipboard content changes.
 */
export function usePasteSuggestion(disabled: boolean): {
  suggestion: PasteSuggestion | null;
  dismiss: () => void;
} {
  const [suggestion, setSuggestion] = useState<PasteSuggestion | null>(null);
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);

  const check = useCallback(async () => {
    if (disabled) return;
    if (!navigator.clipboard?.readText) return;
    try {
      const raw = await navigator.clipboard.readText();
      if (!raw) {
        setSuggestion(null);
        return;
      }
      // Cheap heuristic before invoking libphonenumber:
      // must contain at least 6 digits.
      const digits = raw.replace(/\D/g, '');
      if (digits.length < 6 || digits.length > 17) {
        setSuggestion(null);
        return;
      }
      const norm = normalizeE164(raw);
      if (!norm.ok || !norm.e164) {
        setSuggestion(null);
        return;
      }
      if (dismissedFor === norm.e164) {
        // user dismissed this exact suggestion; wait for clipboard to change
        return;
      }
      setSuggestion({ e164: norm.e164, formatted: formatForDisplay(norm.e164) });
    } catch {
      // Permission denied or clipboard empty — silently ignore.
      setSuggestion(null);
    }
  }, [disabled, dismissedFor]);

  useEffect(() => {
    check();
    function onFocus() { check(); }
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [check]);

  const dismiss = useCallback(() => {
    if (suggestion) setDismissedFor(suggestion.e164);
    setSuggestion(null);
  }, [suggestion]);

  return { suggestion, dismiss };
}
