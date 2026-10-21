import { Socket, type Channel } from 'phoenix';

// One live connection to the server, shared by every screen.
let socket: Socket | null = null;
const channels = new Map<string, { channel: Channel; count: number }>();

export function connect(token: string) {
  if (socket) return socket;
  socket = new Socket('/socket', { params: { token }, reconnectAfterMs: (n) => [500, 1000, 2000, 5000][n - 1] ?? 8000 });
  socket.connect();
  return socket;
}

export function disconnect() {
  channels.forEach(({ channel }) => channel.leave());
  channels.clear();
  socket?.disconnect();
  socket = null;
}

/**
 * Joins a topic, sharing one channel between every screen that wants it.
 * Returns the channel and a function that leaves when the last user is done.
 */
export function join(topic: string): [Channel, () => void] {
  if (!socket) throw new Error('Not connected');
  let entry = channels.get(topic);
  if (!entry) {
    const channel = socket.channel(topic, {});
    channel.join();
    entry = { channel, count: 0 };
    channels.set(topic, entry);
  }
  entry.count += 1;
  const held = entry;
  let left = false;
  return [
    held.channel,
    () => {
      if (left) return;
      left = true;
      held.count -= 1;
      if (held.count <= 0) {
        held.channel.leave();
        channels.delete(topic);
      }
    },
  ];
}

export function onConnectionChange(cb: (online: boolean) => void) {
  if (!socket) return () => {};
  const a = socket.onOpen(() => cb(true));
  const b = socket.onClose(() => cb(false));
  const c = socket.onError(() => cb(false));
  return () => socket?.off([a, b, c]);
}

/** A channel of its own, with join parameters, for things like a call on this device. */
export function openChannel(topic: string, params: Record<string, unknown>): Channel {
  if (!socket) throw new Error('Not connected');
  return socket.channel(topic, params);
}
