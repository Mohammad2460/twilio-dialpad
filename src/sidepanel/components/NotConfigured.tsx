export function NotConfigured() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <h2 className="text-lg font-medium">Welcome to Twilio Dialpad</h2>
      <p className="text-sm text-gray-600">
        You haven't set up your Twilio account yet. Open the setup wizard to provision API keys and deploy the Twilio Function.
      </p>
      <button
        type="button"
        onClick={() => chrome.runtime.openOptionsPage()}
        className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
      >
        Open setup
      </button>
    </div>
  );
}
