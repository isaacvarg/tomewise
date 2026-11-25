import { useEffect, useState } from "react";
import { api, type Update } from "../api.ts";
import { onChange } from "../changes.ts";

function useUpdate(): Update | null {
  const [update, setUpdate] = useState<Update | null>(null);
  useEffect(() => {
    let live = true;
    const check = () => api.update().then((fresh) => live && setUpdate(fresh), () => {});
    check();
    const stop = onChange((kind) => kind === "reconnected" && check());
    return () => {
      live = false;
      stop();
    };
  }, []);
  return update;
}

export function UpdateNotice() {
  const update = useUpdate();
  if (update === null) return null;
  return (
    <aside className="tome-update" data-install={update.install} aria-label="Update available">
      <p>
        Tomewise {update.latest} is out. You have {update.current}.
      </p>
      <p>
        <code className="tome-update-command">{update.command}</code>, then {update.then}.
      </p>
    </aside>
  );
}
