import { useEffect, useState } from 'react';
import type { RecentWorkspace } from '../../../shared/ipc';
import { api } from '../api';

export function WelcomeScreen({ onOpenDialog }: { onOpenDialog: () => void }) {
  const [recents, setRecents] = useState<RecentWorkspace[]>([]);

  useEffect(() => {
    void api.invoke('workspace:recents', undefined).then(setRecents);
  }, []);

  return (
    <div className="welcome">
      <h1>LiveDocs</h1>
      <p className="muted">
        Open a repository to read its documentation, explore its structure, and keep generated
        sections in sync with the code.
      </p>
      <button className="primary big" onClick={onOpenDialog}>
        Open folder…
      </button>
      {recents.length > 0 && (
        <div className="recents">
          <h2>Recent workspaces</h2>
          {recents.map((r) => (
            <button
              key={`${r.kind}:${r.label}`}
              className="recent-item"
              onClick={() => void api.invoke('workspace:open', { reference: r.reference })}
            >
              <strong>{r.name}</strong>
              <span className="muted">{r.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
