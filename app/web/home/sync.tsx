import { type ReactNode, useEffect, useRef, useState } from "react";
import { api, type SyncStatus } from "../api.ts";
import { onChange } from "../changes.ts";
import { errorOf } from "../load.ts";
import { Failed } from "../screen.tsx";

export const SYNC_CHECK_MS = 30_000;

const WHEN = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function When({ at }: { at: string | null }) {
  return at === null ? "never" : <time dateTime={at}>{WHEN.format(new Date(at))}</time>;
}

function useSyncStatus() {
  const [status, setStatus] = useState<SyncStatus>();
  const [failed, setFailed] = useState<Error>();
  const [syncing, setSyncing] = useState(false);
  const latest = useRef(0);
  const posting = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    function check() {
      if (posting.current) return;
      const run = ++latest.current;
      api.sync().then(
        (fresh) => {
          if (run !== latest.current || posting.current) return;
          setStatus(fresh);
          setFailed(undefined);
        },
        (error: unknown) => run === latest.current && !posting.current && setFailed(errorOf(error)),
      );
    }
    check();
    const timer = setInterval(check, SYNC_CHECK_MS);
    const stop = onChange((kind) => (kind === "reconnected" || kind === "content" || kind === "events") && check());
    return () => {
      mounted.current = false;
      latest.current++;
      clearInterval(timer);
      stop();
    };
  }, []);

  async function syncNow() {
    posting.current = true;
    latest.current++;
    setSyncing(true);
    setFailed(undefined);
    try {
      const fresh = await api.syncNow();
      if (mounted.current) setStatus(fresh);
    } catch (error) {
      if (mounted.current) setFailed(errorOf(error));
    } finally {
      posting.current = false;
      if (mounted.current) setSyncing(false);
    }
  }

  return { status, failed, syncing, syncNow };
}

function SyncSection({ state, busy = false, children }: { state?: "ok" | "stopped" | "off"; busy?: boolean; children: ReactNode }) {
  return (
    <section className="tome-sync" data-sync={state} aria-label="Git sync" aria-busy={busy}>
      {children}
    </section>
  );
}

export function Sync() {
  const { status, failed, syncing, syncNow } = useSyncStatus();
  if (status === undefined) {
    return failed && <SyncSection>{<Failed error={failed} />}</SyncSection>;
  }
  if (!status.enabled) {
    return (
      <SyncSection state="off">
        <p className="tome-hint">Git sync is off</p>
      </SyncSection>
    );
  }
  return (
    <SyncSection state={status.stopped ? "stopped" : "ok"} busy={syncing}>
      {status.stopped && status.lastError && (
        <p className="tome-notice" role="alert">
          Sync stopped: {status.lastError.message}
        </p>
      )}
      {failed && <Failed error={failed} />}
      <span className="tome-meta">
        Pulled <When at={status.lastPull} /> · Pushed <When at={status.lastPush} />
      </span>
      <button type="button" className="tome-sync-now" disabled={syncing} onClick={() => void syncNow()}>
        {syncing ? "Syncing…" : "Sync now"}
      </button>
    </SyncSection>
  );
}
