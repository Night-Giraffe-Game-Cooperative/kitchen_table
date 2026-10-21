import { useEffect, useRef, useState } from 'react';
import { Button, Dialog } from './ui';

// Asking before something that can't be undone, in the app's own dialog
// rather than the browser's (which shows the site's address and OK).

interface Ask {
  title: string;
  body?: string;
  action: string;
  resolve: (yes: boolean) => void;
}

let show: ((ask: Ask) => void) | null = null;

/** Resolves true if they press the action, false if they cancel. */
export function confirmFirst(title: string, action: string, body?: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (show) show({ title, body, action, resolve });
    else resolve(window.confirm(body ? `${title} ${body}` : title));
  });
}

export function ConfirmHost() {
  const [ask, setAsk] = useState<Ask | null>(null);
  const current = useRef<Ask | null>(null);

  useEffect(() => {
    show = (next) => {
      current.current?.resolve(false);
      current.current = next;
      setAsk(next);
    };
    return () => {
      show = null;
    };
  }, []);

  if (!ask) return null;
  const answer = (yes: boolean) => {
    ask.resolve(yes);
    current.current = null;
    setAsk(null);
  };

  return (
    <Dialog
      open
      size="sm"
      onClose={() => answer(false)}
      title={ask.title}
      footer={
        <>
          <Button onClick={() => answer(false)}>Cancel</Button>
          <Button variant="danger" onClick={() => answer(true)}>
            {ask.action}
          </Button>
        </>
      }
    >
      {ask.body ? <p>{ask.body}</p> : null}
    </Dialog>
  );
}
