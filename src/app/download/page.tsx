import type { Metadata } from "next";

export const metadata: Metadata = { title: "Almanac for Android" };

// Where testers get the Android app. It's not on the Play Store, so Android asks a couple of extra questions.
export default function Download() {
  return (
    <main className="mx-auto max-w-lg px-5 py-12">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Test version</p>
      <h1 className="mt-2 font-serif text-5xl">Almanac for Android</h1>
      <p className="mt-4 text-muted">Your calendar as a real app on your phone. Open this page on the Android phone itself.</p>
      <a href="/almanac.apk" download className="mt-8 inline-block rounded-full bg-ink px-6 py-3 font-medium text-paper">
        Download the app
      </a>
      <ol className="mt-10 list-decimal space-y-3 pl-5 text-sm">
        <li>Tap <b>Download the app</b>, then open the file when it finishes.</li>
        <li>
          If Android asks, allow <b>Install unknown apps</b> for Chrome (Settings opens; switch it on, then go back).
        </li>
        <li>
          Play Protect may say it doesn&rsquo;t recognise the app, because it isn&rsquo;t on the Play Store. Tap <b>More details</b> →{" "}
          <b>Install anyway</b>.
        </li>
        <li>
          Open Almanac and tap <b>Continue with Google</b>. Sign-in opens in the browser, then brings you back to the app.
        </li>
      </ol>
      <p className="mt-8 text-sm text-muted">
        To update, download and install it again from this page; your sign-in stays. iPhone can&rsquo;t install apps from a website: on iPhone, open
        Almanac in Safari and use Share → Add to Home Screen.
      </p>
    </main>
  );
}
