import { useCallStore } from '../stores/call-store';
import { getManager } from '../hooks/use-device';
import { formatForDisplay } from '@shared/phone';
import { formatRelativeDate } from '@shared/hubspot';

export function IncomingCall() {
  const call = useCallStore((s) => s.activeCall)!;
  const contact = call.contact;

  return (
    <div className="flex h-full flex-col items-center justify-between p-6">
      <div className="mt-12 flex flex-col items-center">
        <div className="h-20 w-20 animate-pulse rounded-full bg-green-100" />
        <p className="mt-4 text-sm uppercase tracking-wide text-gray-500">Incoming call</p>

        {contact ? (
          <>
            <h2 className="mt-2 text-2xl font-medium text-gray-900">{contact.name}</h2>
            <p className="mt-1 text-sm tabular-nums text-gray-500">{formatForDisplay(call.remoteNumber)}</p>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-xs">
              {contact.lifecycleStage && (
                <span className="rounded-full bg-blue-50 px-2 py-0.5 font-medium capitalize text-blue-700">
                  {contact.lifecycleStage}
                </span>
              )}
              {contact.lastContacted && formatRelativeDate(contact.lastContacted) && (
                <span className="text-gray-500">
                  Last contact: {formatRelativeDate(contact.lastContacted)}
                </span>
              )}
            </div>
            <a
              href={contact.portalUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 text-xs font-medium text-orange-600 hover:text-orange-700"
            >
              Open in HubSpot ↗
            </a>
          </>
        ) : (
          <h2 className="mt-2 text-2xl font-medium">{formatForDisplay(call.remoteNumber)}</h2>
        )}
      </div>
      <div className="mb-6 flex w-full justify-around">
        <button
          type="button"
          onClick={() => getManager().reject()}
          className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500 text-white shadow-md hover:bg-red-600"
          title="Reject"
        >
          ✕
        </button>
        <button
          type="button"
          onClick={() => getManager().accept()}
          className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500 text-white shadow-md hover:bg-green-600"
          title="Accept"
        >
          ✓
        </button>
      </div>
    </div>
  );
}
