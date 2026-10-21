import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { join } from '../lib/socket';
import { useStore } from '../lib/store';
import type { Game } from '../lib/types';
import type { Play, Update } from './common';

/** Loads a game, keeps it live, and makes moves with a retry when someone moved first. */
export function useGame<S>(id: number): { game: Game<S> | null; error: string | null; play: Play<S> } {
  const { toast } = useStore();
  const [game, setGame] = useState<Game<S> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const latest = useRef<Game<S> | null>(null);
  const channel = useRef<ReturnType<typeof join>[0] | null>(null);

  const accept = useCallback((g: Game<S>) => {
    if (latest.current && latest.current.id === g.id && g.version < latest.current.version) return;
    latest.current = g;
    setGame(g);
  }, []);

  const fetchGame = useCallback(async () => {
    const res = await api.get<{ game: Game<S> }>(`/api/games/${id}`);
    accept(res.game);
    return res.game;
  }, [id, accept]);

  useEffect(() => {
    latest.current = null;
    setGame(null);
    setError(null);
    fetchGame().catch((e) => setError(e.message));

    const [ch, leave] = join(`game:${id}`);
    channel.current = ch;
    const a = ch.on('game:updated', (g: Game<S>) => accept(g));
    // Strokes drawn by others in a live doodle.
    const b = ch.on('stroke', ({ stroke, version }: { stroke: Record<string, unknown>; version: number }) => {
      const g = latest.current;
      if (!g) return;
      const state = g.state as Record<string, unknown>;
      const strokes = (state.strokes as unknown[]) ?? [];
      accept({ ...g, version, state: { ...state, strokes: [...strokes, stroke] } as unknown as Game<S>['state'] });
    });
    return () => {
      ch.off('game:updated', a);
      ch.off('stroke', b);
      channel.current = null;
      leave();
    };
  }, [id, fetchGame, accept]);

  const move = useCallback(
    async (next: (state: S, game: Game<S>) => Update<S> | null) => {
      setBusy(true);
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          const g = attempt === 0 && latest.current ? latest.current : await fetchGame();
          const update = next(g.state as S, g);
          if (!update) {
            if (attempt > 0) toast('Someone else moved first, so have another look.', 'info');
            return false;
          }
          try {
            const res = await api.post<{ game: Game<S> }>(`/api/games/${id}/moves`, {
              version: g.version,
              state: update.state,
              status: update.status,
              summary: update.summary,
            });
            accept(res.game);
            return true;
          } catch (e) {
            if (e instanceof ApiError && e.status === 409) continue;
            throw e;
          }
        }
        toast('Lots of people are playing at once. Try that again.', 'info');
        return false;
      } catch (e) {
        toast((e as Error).message, 'danger');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [id, fetchGame, accept, toast],
  );

  const append = useCallback(
    (key: string, item: Record<string, unknown>) => {
      const g = latest.current;
      const ch = channel.current;
      if (!g || !ch) return;
      // Show it straight away; the server adds it for everyone else.
      const state = g.state as Record<string, unknown>;
      const list = (state[key] as unknown[]) ?? [];
      latest.current = { ...g, state: { ...state, [key]: [...list, item] } as unknown as Game<S>['state'] };
      setGame(latest.current);
      ch.push('stroke', { stroke: item })
        .receive('ok', ({ version }: { version: number }) => {
          if (latest.current && latest.current.version < version) latest.current = { ...latest.current, version };
        })
        .receive('error', () => {
          toast("That line didn't save. Check the connection.", 'danger');
          fetchGame().catch(() => {});
        });
    },
    [toast, fetchGame],
  );

  return { game, error, play: { move, busy, append } };
}
