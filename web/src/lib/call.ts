// A video call on this device. Every device in the call connects straight to
// every other one (fine for a family of up to about six); the server's call
// channel only passes the connection offers between them, says who is in the
// call, and carries the games played in it, and the rules a grown-up sets:
// which kids are muted, and whose pens are away.
//
// Connections use the "perfect negotiation" pattern: both sides may start
// one, and when offers cross, the polite side gives way. To keep offers from
// crossing at the start (which can leave a browser never finding a route),
// only the impolite side opens a new connection; the polite side adds its
// camera when the offer arrives.

import { Presence, type Channel } from 'phoenix';
import { openChannel } from './socket';
import type { InkStroke } from './callInk';

export type CallError = 'insecure' | 'denied' | 'no-device' | 'no-calls' | 'forbidden' | 'closed' | 'lost';

export interface CallPeer {
  peer: string;
  userId: number;
  stream: MediaStream;
  muted: boolean;
  camera: boolean;
  connected: boolean;
}

export interface FloatingReaction {
  id: number;
  emoji: string;
  userId: number;
  x: number;
}

export interface Snap {
  peer: string;
  userId: number;
  image: string;
}

export interface InkIdea {
  id: number;
  text: string;
  by: number;
}

/** What a grown-up has set in the call, each as kid's user id → the grown-up who set it. */
export interface CallRules {
  /** Kids who are muted: their microphone stays off, and no one hears them, until a grown-up lets them talk. */
  muted: Record<number, number>;
  /** Kids whose pens are away, so they can't draw on the pictures. */
  noPens: Record<number, number>;
}

export const noRules: CallRules = { muted: {}, noPens: {} };

export interface CallSnapshot {
  status: 'starting' | 'in-call' | 'ended';
  /** Why the camera or the call isn't working, if it isn't. */
  error: CallError | null;
  local: MediaStream | null;
  hasVideo: boolean;
  hasAudio: boolean;
  muted: boolean;
  camera: boolean;
  facing: 'user' | 'environment';
  canFlip: boolean;
  peers: CallPeer[];
  startedAt: number | null;
  /** The game being played in the call, shared by everyone in it. */
  game: Record<string, unknown> | null;
  /** When this device last received the game, by its own clock. */
  gameAt: number;
  snaps: Record<number, Snap[]>;
  reactions: FloatingReaction[];
  /** How many drawings are on the pictures, and how many of them are this device's. */
  inkCount: number;
  myInk: number;
  /** A suggestion for what to draw on someone, shown to everyone for a while. */
  idea: InkIdea | null;
  rules: CallRules;
}

interface Conn {
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  stream: MediaStream;
  queue: Promise<void>;
  /** Candidates that came before the offer or answer they belong to. */
  early: RTCIceCandidateInit[];
  watchdog: number;
  /** Whether this device's camera and microphone are on the connection yet. */
  sending: boolean;
  startSending: () => void;
  fallback: number;
}

interface Meta {
  user_id: number;
  muted: boolean;
  camera: boolean;
}

type Signal = { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };

/** A drawing (or the newest part of one) as it travels: points from index i on. */
interface InkMessage {
  id: string;
  on: string;
  by: number;
  kind: InkStroke['kind'];
  colour: string;
  size: number;
  sticker?: InkStroke['sticker'];
  i: number;
  p: number[];
  done?: boolean;
}

let reactionId = 0;
let ideaId = 0;

export class CallSession {
  readonly peerId = randomId();
  private channel: Channel | null = null;
  private conns = new Map<string, Conn>();
  private metas = new Map<string, Meta>();
  private listeners = new Set<() => void>();
  private local: MediaStream | null = null;
  private closed = false;
  private snapshotValue: CallSnapshot;
  private game: Record<string, unknown> | null = null;
  private gameAt = 0;
  private snaps: Record<number, Snap[]> = {};
  private reactions: FloatingReaction[] = [];
  private state = { muted: false, camera: true, facing: 'user' as 'user' | 'environment', canFlip: false };
  private ink = new Map<string, InkStroke>();
  private inkListeners = new Set<() => void>();
  private myStrokes: string[] = [];
  private strokeCount = 0;
  private inkSent = new Map<string, number>();
  private inkDirty = new Set<string>();
  private inkTimer = 0;
  private idea: InkIdea | null = null;
  private rules: CallRules = noRules;
  /** Whether this device was muted before a grown-up muted it, while they have. */
  private mutedBefore: boolean | null = null;
  private status: CallSnapshot['status'] = 'starting';
  private error: CallError | null = null;
  private startedAt: number | null = null;

  constructor(
    readonly roomId: number,
    readonly me: number,
    private iceServers: RTCIceServer[],
  ) {
    this.snapshotValue = this.makeSnapshot();
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  snapshot = () => this.snapshotValue;

  private emit() {
    this.snapshotValue = this.makeSnapshot();
    this.listeners.forEach((fn) => fn());
  }

  private makeSnapshot(): CallSnapshot {
    const peers: CallPeer[] = [];
    for (const [peer, conn] of this.conns) {
      const meta = this.metas.get(peer);
      if (!meta) continue;
      peers.push({
        peer,
        userId: meta.user_id,
        stream: conn.stream,
        muted: meta.muted,
        camera: meta.camera,
        connected: conn.pc.connectionState === 'connected',
      });
    }
    peers.sort((a, b) => a.peer.localeCompare(b.peer));
    return {
      status: this.status,
      error: this.error,
      local: this.local,
      hasVideo: !!this.local?.getVideoTracks().length,
      hasAudio: !!this.local?.getAudioTracks().length,
      muted: this.state.muted,
      camera: this.state.camera,
      facing: this.state.facing,
      canFlip: this.state.canFlip,
      peers,
      startedAt: this.startedAt,
      game: this.game,
      gameAt: this.gameAt,
      snaps: this.snaps,
      reactions: this.reactions,
      inkCount: this.ink.size,
      myInk: this.myStrokes.length,
      idea: this.idea,
      rules: this.rules,
    };
  }

  /** Gets the camera and microphone, then joins the call. */
  async start() {
    this.local = await this.getMedia(this.state.facing);
    if (this.closed) {
      stopAll(this.local);
      return;
    }
    this.countCameras();
    this.join();
    this.emit();
  }

  private async getMedia(facing: 'user' | 'environment'): Promise<MediaStream | null> {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      this.error = 'insecure';
      return null;
    }
    const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    const video = { facingMode: facing, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 } };
    try {
      return await navigator.mediaDevices.getUserMedia({ audio, video });
    } catch (e) {
      const name = (e as DOMException).name;
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        this.error = 'denied';
        return null;
      }
      // No camera (a desktop PC, say): try for just the microphone.
      try {
        return await navigator.mediaDevices.getUserMedia({ audio });
      } catch {
        this.error = 'no-device';
        return null;
      }
    }
  }

  private async countCameras() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      this.state.canFlip = devices.filter((d) => d.kind === 'videoinput').length > 1;
      this.emit();
    } catch {
      // Not knowing just means no flip button.
    }
  }

  private join() {
    const channel = openChannel(`call:${this.roomId}`, { peer: this.peerId });
    this.channel = channel;
    const presence = new Presence(channel);

    presence.onSync(() => {
      const seen = new Set<string>();
      presence.list((peer: string, { metas }: { metas: Meta[] }) => {
        seen.add(peer);
        if (peer === this.peerId) return;
        this.metas.set(peer, metas[0]);
        if (!this.conns.has(peer)) this.connect(peer);
      });
      for (const peer of [...this.conns.keys()]) if (!seen.has(peer)) this.drop(peer);
      this.emit();
    });

    channel.on('signal', ({ from, to, data }: { from: string; to: string; data: Signal }) => {
      if (to !== this.peerId) return;
      const conn = this.conns.get(from) ?? this.connect(from);
      conn.queue = conn.queue.then(() => this.handleSignal(from, conn, data)).catch(() => {});
    });

    channel.on('game', ({ game }: { game: Record<string, unknown> | null }) => {
      this.game = game;
      this.gameAt = Date.now();
      this.emit();
    });

    channel.on('snap', ({ peer, user_id, image, round }: { peer: string; user_id: number; image: string; round: number }) => {
      const list = (this.snaps[round] ?? []).filter((s) => s.peer !== peer);
      this.snaps = { ...this.snaps, [round]: [...list, { peer, userId: user_id, image }] };
      this.emit();
    });

    channel.on('ink', (m: InkMessage) => this.receiveInk(m));

    channel.on('ink_state', ({ strokes }: { strokes: InkStroke[] }) => {
      for (const s of strokes) if (!this.ink.has(s.id)) this.ink.set(s.id, { ...s, live: false });
      this.emitInk();
      this.emit();
    });

    channel.on('ink_undo', ({ id }: { id: string }) => {
      if (this.ink.delete(id)) {
        this.emitInk();
        this.emit();
      }
    });

    channel.on('ink_wipe', () => {
      this.ink.clear();
      this.myStrokes = [];
      this.emitInk();
      this.emit();
    });

    channel.on('ink_idea', ({ text, by }: { text: string; by: number }) => {
      const idea = { id: ++ideaId, text, by };
      this.idea = idea;
      this.emit();
      window.setTimeout(() => {
        if (this.idea?.id !== idea.id) return;
        this.idea = null;
        this.emit();
      }, 15000);
    });

    channel.on('rules', ({ muted, no_pens }: { muted: Record<string, number>; no_pens: Record<string, number> }) => {
      this.rules = { muted: byUser(muted), noPens: byUser(no_pens) };
      // Muted by a grown-up: the microphone goes off, and stays off until
      // they say. Then it goes back to how it was.
      const hushed = !!this.rules.muted[this.me];
      if (hushed && this.mutedBefore === null) {
        this.mutedBefore = this.state.muted;
        this.setMuted(true);
      } else if (!hushed && this.mutedBefore !== null) {
        const before = this.mutedBefore;
        this.mutedBefore = null;
        this.setMuted(before);
      }
      // Pens away: anything half drawn goes, here and everywhere else.
      let changed = false;
      for (const [id, s] of this.ink) {
        const unfinished = id.startsWith(this.peerId) ? this.inkSent.has(id) : s.live;
        if (unfinished && this.rules.noPens[s.by]) changed = this.ink.delete(id);
      }
      if (changed) this.emitInk();
      this.emit();
    });

    channel.on('react', ({ emoji, user_id }: { emoji: string; user_id: number }) => {
      const r = { id: ++reactionId, emoji, userId: user_id, x: 10 + Math.random() * 80 };
      this.reactions = [...this.reactions.slice(-11), r];
      this.emit();
      window.setTimeout(() => {
        this.reactions = this.reactions.filter((x) => x.id !== r.id);
        this.emit();
      }, 3200);
    });

    channel
      .join()
      .receive('ok', ({ started_at }: { started_at: string }) => {
        this.status = 'in-call';
        this.startedAt = Date.parse(started_at) || Date.now();
        this.pushState();
        this.emit();
      })
      .receive('error', ({ reason }: { reason: string }) => {
        this.error = reason === 'no_calls' ? 'no-calls' : reason === 'closed' ? 'closed' : 'forbidden';
        this.leave();
      });

    channel.onError(() => {
      if (this.closed) return;
      this.error = 'lost';
      this.emit();
    });
    channel.onClose(() => this.emit());
  }

  private connect(peer: string): Conn {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const conn: Conn = {
      pc,
      polite: this.peerId > peer,
      makingOffer: false,
      ignoreOffer: false,
      stream: new MediaStream(),
      queue: Promise.resolve(),
      early: [],
      watchdog: 0,
      sending: false,
      startSending: () => {},
      fallback: 0,
    };
    // When offers cross at the very start, a candidate can go astray and the
    // two devices never find each other. If they haven't connected after a
    // few seconds, the impolite side starts the connection checks again, less
    // and less often (6, 18, 42 and 90 seconds in) so a slow start isn't cut
    // short. Both sides tell the server what they could see, for its log.
    let ticks = 0;
    conn.watchdog = window.setInterval(() => {
      const state = pc.connectionState;
      if (state === 'connected' || state === 'closed') {
        ticks = 0;
        return;
      }
      ticks += 1;
      if (ticks === 2 || ticks === 5) void this.report(peer, pc);
      if (conn.polite || ![1, 3, 7, 15].includes(ticks)) return;
      if (pc.signalingState === 'stable' && !conn.makingOffer) pc.restartIce();
    }, 6000);
    this.conns.set(peer, conn);

    conn.startSending = () => {
      if (conn.sending) return;
      conn.sending = true;
      window.clearTimeout(conn.fallback);
      if (this.local) {
        for (const track of this.local.getTracks()) pc.addTrack(track, this.local);
      }
      // Always ask for both, so a device without a camera still sees everyone.
      for (const kind of ['audio', 'video'] as const) {
        if (!pc.getTransceivers().some((t) => t.receiver.track.kind === kind)) pc.addTransceiver(kind, { direction: 'recvonly' });
      }
    };
    if (conn.polite) {
      // If no offer comes, start the connection from this side after all.
      conn.fallback = window.setTimeout(conn.startSending, 2500);
    } else {
      conn.startSending();
    }

    pc.ontrack = ({ track }) => {
      for (const old of conn.stream.getTracks().filter((t) => t.kind === track.kind && t.id !== track.id)) {
        conn.stream.removeTrack(old);
      }
      if (!conn.stream.getTrackById(track.id)) conn.stream.addTrack(track);
      // A fresh stream object, so video elements pick up the change.
      conn.stream = new MediaStream(conn.stream.getTracks());
      track.onunmute = () => this.emit();
      this.emit();
    };

    pc.onnegotiationneeded = async () => {
      try {
        conn.makingOffer = true;
        await pc.setLocalDescription();
        this.signal(peer, { description: pc.localDescription!.toJSON() });
      } catch {
        // The next negotiation will try again.
      } finally {
        conn.makingOffer = false;
      }
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.signal(peer, { candidate: candidate.toJSON() });
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') pc.restartIce();
      this.emit();
    };

    return conn;
  }

  private async handleSignal(peer: string, conn: Conn, { description, candidate }: Signal) {
    const pc = conn.pc;
    if (description) {
      const collision = description.type === 'offer' && (conn.makingOffer || pc.signalingState !== 'stable');
      conn.ignoreOffer = !conn.polite && collision;
      if (conn.ignoreOffer) return;
      await pc.setRemoteDescription(description);
      if (description.type === 'offer') {
        conn.startSending();
        await pc.setLocalDescription();
        this.signal(peer, { description: pc.localDescription!.toJSON() });
      }
      for (const c of conn.early.splice(0)) await pc.addIceCandidate(c).catch(() => {});
    } else if (candidate) {
      if (!pc.remoteDescription) {
        conn.early.push(candidate);
        return;
      }
      try {
        await pc.addIceCandidate(candidate);
      } catch (e) {
        if (!conn.ignoreOffer) throw e;
      }
    }
  }

  private signal(to: string, data: Signal) {
    this.channel?.push('signal', { to, data });
  }

  /** What this device could see of a connection that won't connect, for the server's log. */
  private async report(peer: string, pc: RTCPeerConnection) {
    try {
      const stats = await pc.getStats();
      const candidates = new Map<string, string>();
      const local: string[] = [];
      const remote: string[] = [];
      const pairs: string[] = [];
      stats.forEach((r) => {
        if (r.type !== 'local-candidate' && r.type !== 'remote-candidate') return;
        const text = `${r.candidateType} ${r.protocol} ${r.address ?? r.ip ?? '?'}:${r.port}`;
        candidates.set(r.id, text);
        (r.type === 'local-candidate' ? local : remote).push(text);
      });
      stats.forEach((r) => {
        if (r.type !== 'candidate-pair') return;
        pairs.push(
          `${candidates.get(r.localCandidateId)} > ${candidates.get(r.remoteCandidateId)} ${r.state}, ${r.requestsSent ?? 0} sent, ${r.responsesReceived ?? 0} answered`,
        );
      });
      this.channel?.push('debug', {
        about: peer,
        state: `${pc.connectionState} ice ${pc.iceConnectionState} gathering ${pc.iceGatheringState} signalling ${pc.signalingState}`,
        local: local.slice(0, 12),
        remote: remote.slice(0, 12),
        pairs: pairs.slice(0, 16),
        browser: navigator.userAgent.slice(0, 200),
      });
    } catch {
      // Only ever for the log.
    }
  }

  private drop(peer: string) {
    const conn = this.conns.get(peer);
    if (conn) {
      window.clearInterval(conn.watchdog);
      window.clearTimeout(conn.fallback);
    }
    conn?.pc.close();
    this.conns.delete(peer);
    this.metas.delete(peer);
    // Drawings on someone who has gone go with them.
    for (const [id, s] of this.ink) {
      if (s.on === peer) this.ink.delete(id);
      else if (s.live && id.startsWith(peer)) s.live = false;
    }
    this.emitInk();
  }

  // Drawing on the pictures ---------------------------------------------------

  /** For the drawing layers: called whenever any drawing changes. */
  subscribeInk = (fn: () => void) => {
    this.inkListeners.add(fn);
    return () => this.inkListeners.delete(fn);
  };

  private emitInk() {
    this.inkListeners.forEach((fn) => fn());
  }

  /** The drawings on one person's picture, oldest first. */
  inkOn(peer: string): InkStroke[] {
    return [...this.ink.values()].filter((s) => s.on === peer);
  }

  /** Starts a pen stroke or a sticker on someone's picture. */
  beginStroke(start: Omit<InkStroke, 'id' | 'by'>): InkStroke {
    const stroke: InkStroke = { ...start, id: `${this.peerId}-${++this.strokeCount}`, by: this.me };
    this.ink.set(stroke.id, stroke);
    this.myStrokes.push(stroke.id);
    this.inkSent.set(stroke.id, 0);
    this.queueInk(stroke.id);
    this.emitInk();
    this.emit();
    return stroke;
  }

  /** Call after adding points to a stroke (or moving a sticker). */
  updateStroke(id: string) {
    this.queueInk(id);
    this.emitInk();
  }

  /** Sends the whole stroke once more, finished, so it's kept for late joiners. */
  endStroke(id: string) {
    const s = this.ink.get(id);
    this.inkDirty.delete(id);
    this.inkSent.delete(id);
    if (s) this.channel?.push('ink', this.inkMessage(s, 0, true));
  }

  undoInk() {
    let id: string | undefined;
    while ((id = this.myStrokes.pop()) && !this.ink.has(id));
    if (!id) return;
    this.ink.delete(id);
    this.inkDirty.delete(id);
    this.channel?.push('ink_undo', { id });
    this.emitInk();
    this.emit();
  }

  /** Clears every drawing off everyone's picture. */
  wipeInk() {
    this.ink.clear();
    this.myStrokes = [];
    this.inkDirty.clear();
    this.channel?.push('ink_wipe', {});
    this.emitInk();
    this.emit();
  }

  shareIdea(text: string) {
    this.channel?.push('ink_idea', { text });
  }

  private queueInk(id: string) {
    this.inkDirty.add(id);
    // Sends what's new about twenty times a second, so others see it drawn.
    if (!this.inkTimer) this.inkTimer = window.setTimeout(() => this.flushInk(), 50);
  }

  private flushInk() {
    this.inkTimer = 0;
    for (const id of this.inkDirty) {
      const s = this.ink.get(id);
      if (!s) continue;
      const from = s.kind === 'sticker' ? 0 : Math.min(this.inkSent.get(id) ?? 0, s.points.length);
      this.channel?.push('ink', this.inkMessage(s, from, false));
      this.inkSent.set(id, s.points.length);
    }
    this.inkDirty.clear();
  }

  private inkMessage(s: InkStroke, from: number, done: boolean): Omit<InkMessage, 'by'> {
    return { id: s.id, on: s.on, kind: s.kind, colour: s.colour, size: s.size, sticker: s.sticker, i: from, p: s.points.slice(from), done };
  }

  private receiveInk(m: InkMessage) {
    if (m.id.startsWith(this.peerId)) return;
    const old = this.ink.get(m.id);
    const points = (old?.points ?? []).slice(0, m.i).concat(m.p);
    const stroke: InkStroke = { id: m.id, on: m.on, by: m.by, kind: m.kind, colour: m.colour, size: m.size, sticker: m.sticker, points, live: !m.done, at: Date.now() };
    this.ink.set(m.id, stroke);
    this.emitInk();
    if (!old) this.emit();
  }

  private pushState() {
    this.channel?.push('state', { muted: this.state.muted, camera: this.state.camera });
  }

  setMuted(muted: boolean) {
    if (!muted && this.rules.muted[this.me]) return;
    this.state.muted = muted;
    this.local?.getAudioTracks().forEach((t) => (t.enabled = !muted));
    this.pushState();
    this.emit();
  }

  setCamera(on: boolean) {
    this.state.camera = on;
    this.local?.getVideoTracks().forEach((t) => (t.enabled = on));
    this.pushState();
    this.emit();
  }

  /** Swaps between the front and back cameras. */
  async flip() {
    const facing = this.state.facing === 'user' ? 'environment' : 'user';
    const old = this.local?.getVideoTracks()[0];
    try {
      old?.stop();
      const fresh = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { exact: facing }, width: { ideal: 640 }, height: { ideal: 480 } } });
      const track = fresh.getVideoTracks()[0];
      track.enabled = this.state.camera;
      for (const { pc } of this.conns.values()) {
        const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
        await sender?.replaceTrack(track);
      }
      if (this.local) {
        if (old) this.local.removeTrack(old);
        this.local.addTrack(track);
        this.local = new MediaStream(this.local.getTracks());
      }
      this.state.facing = facing;
    } catch {
      // Keep whatever camera still works.
    }
    this.emit();
  }

  /** Shares a new state for the call's game with everyone in the call. */
  setGame(game: Record<string, unknown> | null) {
    this.channel?.push('game', { game });
  }

  sendSnap(round: number, image: string) {
    this.channel?.push('snap', { round, image });
  }

  react(emoji: string) {
    this.channel?.push('react', { emoji });
  }

  /** For grown-ups: mutes kids or puts their pens away, or lets them again. */
  setRule(rule: 'mute' | 'pens', userIds: number[], on: boolean) {
    if (userIds.length) this.channel?.push('rule', { rule, user_ids: userIds, on });
  }

  leave() {
    if (this.closed) return;
    this.closed = true;
    window.clearTimeout(this.inkTimer);
    this.channel?.leave();
    for (const peer of [...this.conns.keys()]) this.drop(peer);
    stopAll(this.local);
    this.status = 'ended';
    this.emit();
  }
}

function byUser(ids: Record<string, number>): Record<number, number> {
  return Object.fromEntries(Object.entries(ids ?? {}).map(([id, by]) => [Number(id), by]));
}

function stopAll(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop());
}

function randomId(): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
