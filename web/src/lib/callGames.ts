// The games played inside a video call. Their state is shared through the
// call channel: whoever acts sends the whole new state, and everyone shows it.
// Times travel as "milliseconds left" rather than clock times, because the
// family's devices don't agree on the time to the second.

export interface FaceGame {
  kind: 'face';
  round: number;
  prompt: string;
  /** Stars given to each photo, by the photo's device: voter user ids. */
  stars: Record<string, number[]>;
  used: string[];
}

export interface ActGame {
  kind: 'act';
  phase: 'acting' | 'between';
  actor: number;
  word: string;
  remainingMs: number;
  /** Words guessed and skipped in this turn. */
  got: number;
  skipped: number;
  turn: number;
  /** Words guessed while each person was acting, over the whole game. */
  scores: Record<string, number>;
  best: number;
  used: string[];
}

export interface DrawGame {
  kind: 'draw';
  gameId: number;
}

export type CallGame = FaceGame | ActGame | DrawGame;

export const ACT_SECONDS = 60;

export const faces = [
  'a surprised owl 🦉',
  'a grumpy cat 😾',
  'the happiest dog in the world 🐶',
  'someone who smelled a stinky sock 🧦',
  'a lion roaring 🦁',
  'a fish blowing bubbles 🐟',
  'a very sleepy bear 🐻',
  'a cheeky monkey 🐒',
  'a robot with a flat battery 🤖',
  'a pirate who lost his treasure 🏴‍☠️',
  "you've just won a prize 🏆",
  'you bit into a sour lemon 🍋',
  'a friendly ghost 👻',
  'a superhero saving the day 🦸',
  'a frog catching a fly 🐸',
  'a shy little mouse 🐭',
  'a dragon who wants a friend 🐉',
  'a king or queen waving 👑',
  'a baby tasting broccoli 🥦',
  'a crocodile smiling 🐊',
  'a sneeze about to happen 🤧',
  'an alien saying hello 👽',
  'a snowman in the sunshine ⛄',
  'a chicken who laid a golden egg 🐔',
  'a vampire who likes vegetables 🧛',
  'you saw a spider 🕷️',
  'a tired grandad after lunch 💤',
  'a unicorn showing off 🦄',
  'a penguin who is cold 🐧',
  'you heard a really silly joke 🤣',
];

export const actWords = [
  // Animals
  'a kangaroo', 'a penguin', 'an elephant', 'a snake', 'a monkey', 'a crab', 'a frog', 'a dinosaur', 'a cat washing',
  'a dog wagging its tail', 'a chicken', 'a bird flying', 'a fish', 'a bunny', 'an octopus', 'a horse galloping',
  'a lion', 'a bee', 'a snail', 'a giraffe eating leaves',
  // Doing things
  'brushing your teeth', 'riding a bike', 'swimming', 'eating spaghetti', 'building a snowman', 'playing football',
  'reading a book', 'taking a bath', 'flying a kite', 'baking a cake', 'climbing a ladder', 'skipping', 'fishing',
  'painting a picture', 'blowing up a balloon', 'going to sleep', 'putting on wellies', 'eating an ice cream',
  'playing the guitar', 'walking a dog', 'washing up', 'jumping on a trampoline', 'catching a bus', 'hula hooping',
  'opening a present', 'stirring a big pot', 'hammering a nail', 'ice skating', 'surfing a wave', 'rowing a boat',
  // Being someone
  'a superhero', 'a robot', 'a pirate', 'a king or queen', 'a ballet dancer', 'a firefighter', 'a doctor', 'a chef',
  'a teacher', 'a wizard', 'a ghost', 'a monster', 'a clown juggling', 'an astronaut', 'a snowman melting',
  'a statue', 'a zombie', 'a magician', 'a baby', 'a postman',
];

/** Picks something not used yet; starts over once everything has been used. */
export function pickFresh(list: string[], used: string[], random = Math.random): { item: string; used: string[] } {
  let fresh = list.filter((x) => !used.includes(x));
  let seen = used;
  if (!fresh.length) {
    fresh = list;
    seen = [];
  }
  const item = fresh[Math.floor(random() * fresh.length)];
  return { item, used: [...seen, item] };
}

export function newFace(prev: FaceGame | null, random = Math.random): FaceGame {
  const { item, used } = pickFresh(faces, prev?.used ?? [], random);
  return { kind: 'face', round: (prev?.round ?? 0) + 1, prompt: item, stars: {}, used };
}

/** Gives a photo a star from a person, or takes it back. Nobody stars their own. */
export function toggleStar(game: FaceGame, photoPeer: string, photoOwner: number, voter: number): FaceGame {
  if (photoOwner === voter) return game;
  const voters = game.stars[photoPeer] ?? [];
  const next = voters.includes(voter) ? voters.filter((v) => v !== voter) : [...voters, voter];
  return { ...game, stars: { ...game.stars, [photoPeer]: next } };
}

export function startAct(actor: number, prev: ActGame | null, random = Math.random): ActGame {
  const { item, used } = pickFresh(actWords, prev?.used ?? [], random);
  return {
    kind: 'act',
    phase: 'acting',
    actor,
    word: item,
    remainingMs: ACT_SECONDS * 1000,
    got: 0,
    skipped: 0,
    turn: (prev?.turn ?? 0) + 1,
    scores: prev?.scores ?? {},
    best: prev?.best ?? 0,
    used,
  };
}

/** The actor's family guessed the word: a point, and the next word. */
export function gotIt(game: ActGame, remainingMs: number, random = Math.random): ActGame {
  const { item, used } = pickFresh(actWords, game.used, random);
  const key = String(game.actor);
  return {
    ...game,
    word: item,
    used,
    remainingMs,
    got: game.got + 1,
    scores: { ...game.scores, [key]: (game.scores[key] ?? 0) + 1 },
  };
}

export function skipWord(game: ActGame, remainingMs: number, random = Math.random): ActGame {
  const { item, used } = pickFresh(actWords, game.used, random);
  return { ...game, word: item, used, remainingMs, skipped: game.skipped + 1 };
}

export function endTurn(game: ActGame): ActGame {
  return { ...game, phase: 'between', remainingMs: 0, best: Math.max(game.best, game.got) };
}

/** Who acts next: the next person in the call after the last actor, in a steady order. */
export function nextActor(game: ActGame, inCall: number[]): number {
  const order = [...new Set(inCall)].sort((a, b) => a - b);
  if (!order.length) return game.actor;
  return order.find((id) => id > game.actor) ?? order[0];
}

export function familyTotal(game: ActGame): number {
  return Object.values(game.scores).reduce((n, s) => n + s, 0);
}

/** The photos with the most stars, if anyone gave any. */
export function favourites(game: FaceGame): string[] {
  const counts = Object.entries(game.stars).map(([peer, voters]) => [peer, voters.length] as const);
  const top = Math.max(0, ...counts.map(([, n]) => n));
  return top ? counts.filter(([, n]) => n === top).map(([peer]) => peer) : [];
}
