import { useEffect } from 'react';
import { useStore } from '../lib/store';
import { go } from '../lib/router';
import { startRinging } from '../lib/ringtone';
import { Avatar } from './ui';
import { Icon } from './icons';

const RING_FOR_MS = 45_000;

/** The card that pops up when someone starts a call in one of this person's chats. */
export function IncomingCall() {
  const { ring, dismissRing, people, rooms, me } = useStore();
  const caller = ring ? people.get(ring.by) : undefined;
  const room = ring ? rooms.find((r) => r.id === ring.roomId) : undefined;

  useEffect(() => {
    if (!ring) return;
    const stop = startRinging();
    const timeout = window.setTimeout(dismissRing, RING_FOR_MS);
    return () => {
      stop();
      window.clearTimeout(timeout);
    };
  }, [ring, dismissRing]);

  if (!ring || !me.permissions.video_calls) return null;

  const where = room && room.kind !== 'direct' ? `${room.emoji} ${room.name}` : 'Just you two';

  return (
    <div className="incoming" role="alertdialog" aria-labelledby="incoming-title" aria-describedby="incoming-where">
      <div className="incoming-card sheet">
        <div className="incoming-face">
          <Avatar person={caller} size="xl" />
          <span className="incoming-rings" aria-hidden="true" />
        </div>
        <h2 id="incoming-title">{caller?.name ?? 'Someone'} is calling</h2>
        <p id="incoming-where" className="muted">
          Video call · {where}
        </p>
        <div className="incoming-actions">
          <button type="button" className="call-btn call-btn-decline" onClick={dismissRing}>
            <span className="call-btn-face">
              <Icon name="close" size={26} />
            </span>
            <span>Not now</span>
          </button>
          <button
            type="button"
            className="call-btn call-btn-accept"
            autoFocus
            onClick={() => {
              dismissRing();
              go({ name: 'call', roomId: ring.roomId });
            }}
          >
            <span className="call-btn-face">
              <Icon name="video" size={26} />
            </span>
            <span>Join</span>
          </button>
        </div>
      </div>
    </div>
  );
}
