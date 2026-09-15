import { registerPlugin } from "@capacitor/core";
import { extractSharedUrl } from "./urlExtract";

interface ShareReceiverPlugin {
  consumePending(): Promise<{ text?: string }>;
}

// Backed by android/.../ShareReceiverPlugin.kt + MainActivity.kt's
// ACTION_SEND intent handling.
const ShareReceiver = registerPlugin<ShareReceiverPlugin>("ShareReceiver");

// Call once on app boot: was this launch triggered by Android's share
// sheet? A pull rather than a push, so there's no race with this JS
// listener not being registered yet.
export async function consumePendingShare(): Promise<string | null> {
  const { text } = await ShareReceiver.consumePending();
  return extractSharedUrl({ text });
}

// A share that arrives while the app is already open is pushed live as a
// window event instead (no boot-time race in that case).
export function onLiveShare(handler: (url: string) => void): () => void {
  const listener = (event: Event) => {
    const text = (event as CustomEvent<string>).detail;
    const url = extractSharedUrl({ text });
    if (url) handler(url);
  };
  window.addEventListener("wuxiaShare", listener);
  return () => window.removeEventListener("wuxiaShare", listener);
}
