// Help with writing, by age: simpler story starts and words to begin a line
// with for the youngest, ideas when someone gets stuck, and in learn mode the
// shape of a story (a beginning, a middle and an end) as it's written.
import type { Band } from '../bands';
import type { Lesson, Tip } from '../learn';

export const startersFor: Record<Band, string[]> = {
  '5-7': [
    'A little cat found a big red ball.',
    'The duck wanted to go to school.',
    'One day, it rained jelly beans.',
    'The teddy bear could not find his hat.',
    'A friendly dragon came to tea.',
    'The moon fell into our garden.',
    'A tiny mouse lived in a shoe.',
    'The unicorn lost her shoes.',
    'Our dog can fly, but only on Tuesdays.',
    'There was a little door in the big tree.',
  ],
  '8-10': [
    'Once upon a time, a small dragon found a door in the bottom of the garden.',
    'On the first day of the holidays, the teddy bears woke up before everyone else.',
    'Nobody believed Gran when she said the cat could talk.',
    'The rain had been falling for three days when the boat appeared in the kitchen.',
    'Deep in the wood there was a tree with a round green door and a lantern.',
    "The unicorn had lost her shoes, and the party started at four o'clock.",
    'When the moon came down to visit, it landed right on our trampoline.',
    'The family woke up to find the house had floated up into the clouds.',
    'A very polite spider moved into the bathroom and asked for a towel.',
    'The dog dug a hole so deep that he reached the other side of the world.',
  ],
  '11-13': [
    'The message in the bottle was addressed to me, and it was dated next week.',
    'Every night at midnight, the statue in the park turned its head a little further.',
    'Nobody at school remembered the new girl, except me.',
    'The map showed our street, but there was one house on it I had never seen.',
    'When the lights came back on, everyone in the room had swapped places.',
    'The museum guard swore the dinosaur skeleton had moved in the night.',
    'Our new neighbour only ever came outside when it was snowing.',
    "The lift had a button for a floor that our building didn't have.",
    "Grandad's old radio started picking up messages from the future.",
    'The last tree in the city began to whisper.',
  ],
  '14+': [
    'It was the kind of town where everyone knew your secrets, except the one that mattered.',
    'The letter had waited forty years to be opened, and it began with my name.',
    'By the time the ship reached the edge of the map, only three of us still believed in it.',
    "On the morning the sun didn't rise, every radio station played the same song.",
    'She could always tell when someone was lying, until she met the stranger at the station.',
    'The robot had been built to clean the library, but lately it had started reading.',
    'Everyone in the village agreed never to talk about what happened on the island.',
    'The photograph showed our family, smiling, in a house we had never lived in.',
    'At exactly seven minutes past three, the whole city went silent for one minute.',
    'The expedition found a door in the glacier, and it was unlocked.',
  ],
};

export const isStarter = (text: string) => Object.values(startersFor).some((list) => list.includes(text.trim()));

/** Words to begin a line with: for the youngest, and in learn mode. */
const openers: Record<'young' | 'older', string[]> = {
  young: ['Then', 'Suddenly', 'But', 'So', 'Next', 'At last'],
  older: ['Suddenly,', 'Meanwhile,', 'Just then,', 'Luckily,', 'Unfortunately,', 'Without warning,', 'In the end,'],
};

export type Part = 'beginning' | 'middle' | 'end';

/** Where a line falls in the story: the first quarter, the last quarter, or between. */
export function partOf(lineNo: number, length: number): Part {
  const at = lineNo / Math.max(1, length);
  return at <= 0.25 ? 'beginning' : at > 0.75 ? 'end' : 'middle';
}

export const shape: Record<Part, { title: string; text: string }> = {
  beginning: { title: 'The beginning', text: 'Who is in the story, and where are they?' },
  middle: { title: 'The middle', text: 'Something goes wrong, or someone has a problem.' },
  end: { title: 'The end', text: 'How does it get sorted out? Bring the story home.' },
};

const ideas: Record<Part, string[]> = {
  beginning: [
    'Who else is there? Give them a name.',
    'What can someone see, hear or smell?',
    'Where are they? Is it day or night?',
    'What does someone really want?',
  ],
  middle: [
    'Something goes wrong. What is it?',
    'Someone new arrives. Who are they?',
    'Someone finds something surprising.',
    'The weather changes all of a sudden.',
    'Someone says something out loud. What do they say?',
    'How does someone feel right now, and why?',
  ],
  end: [
    'Someone has a clever idea that fixes things.',
    'How does it all get sorted out?',
    'Who is happy at the end, and why?',
    'Go back to something from the start of the story.',
  ],
};

export interface Help {
  /** Words to begin a line with. */
  openers: string[];
  /** The Idea button. */
  ideas: boolean;
  /** Which part of the story this line is, in the box's hint. */
  shape: boolean;
}

/** The help a band gets: the youngest get the most, 14 and up none. Learn mode gives all of it. */
export function helpFor(band: Band, learn: boolean): Help {
  if (learn) return { openers: band === '5-7' ? openers.young : openers.older, ideas: true, shape: true };
  if (band === '5-7') return { openers: openers.young, ideas: true, shape: true };
  if (band === '8-10') return { openers: openers.older, ideas: true, shape: true };
  if (band === '11-13') return { openers: [], ideas: true, shape: false };
  return { openers: [], ideas: false, shape: false };
}

/** An idea for the part of the story this line is in, not the last one shown. */
export function ideaFor(part: Part, last?: string): string {
  const list = ideas[part].filter((i) => i !== last);
  return list[Math.floor(Math.random() * list.length)];
}

/** The box's hint: how many lines are left, and in some bands which part of the story this is. */
export function lineHint(lineNo: number, length: number, help: Help, plain: string): string {
  if (lineNo >= length) return 'This is the very last line, so make it a good ending!';
  if (!help.shape) return plain;
  const part = shape[partOf(lineNo, length)];
  return `${plain} ${part.title}: ${part.text}`;
}

export const TIPS = {
  first: { key: 'first', basic: true, text: 'Carry on from the first line. Who is in the story, and what can they see?' },
  carry: { key: 'carry', basic: true, text: 'Read the line before yours, then carry the story on from there. One or two sentences is plenty.' },
  problem: { key: 'problem', text: 'Stories get exciting when something goes wrong. Could your line bring in a problem?' },
  ending: { key: 'ending', text: 'Nearly the end. Start sorting out the problem so the story can finish well.' },
  stars: { key: 'stars', basic: true, text: "Give a star to every line you love. You can't star your own, and nobody sees the stars until the end." },
} satisfies Record<string, Tip>;

/** The tip for someone about to write line `lineNo`. */
export function writingTips(lineNo: number, length: number): (Tip | null)[] {
  const part = partOf(lineNo, length);
  return [lineNo === 1 ? TIPS.first : TIPS.carry, part === 'middle' ? TIPS.problem : part === 'end' ? TIPS.ending : null];
}

export const storyBasics: Lesson[] = [
  { art: '📖', title: 'The aim', text: 'Write a story together, one line each, then read the whole thing aloud at the end.' },
  { art: '✏️', title: 'Your line', text: 'Read the line before yours and carry it on. One or two sentences is plenty.' },
  {
    art: '🗺️',
    title: 'A story has a shape',
    text: 'The beginning says who is in it and where. In the middle something goes wrong. The end sorts it out.',
  },
  { art: '💡', title: 'Stuck?', text: 'Tap Idea for a nudge, or tap a word like Suddenly or Luckily to start your line.' },
  { art: '⭐', title: 'Stars', text: 'Playing against each other, everyone stars the lines they love at the end. The most stars wins.' },
];
