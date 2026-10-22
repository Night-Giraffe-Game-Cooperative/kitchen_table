// Help with writing questions, by age: question ideas to tap, and for many of
// them a list of answers to tap too. Tapping the right answer picks the wrong
// ones from the same list, so a young child can make a whole question with
// taps alone (and change any of it after).
import { pick, shuffle } from '../common';
import type { Band } from '../bands';
import { sameAnswer } from './rules';

export type ChipSet =
  | 'colours'
  | 'animals'
  | 'foods'
  | 'toys'
  | 'jobs'
  | 'numbers'
  | 'seasons'
  | 'sports'
  | 'places'
  | 'trips'
  | 'days'
  | 'powers'
  | 'fears'
  | 'subjects';

/** Answers to tap. The emoji stay in the answer, as a picture for people still learning to read. */
export const chipSets: Record<ChipSet, string[]> = {
  colours: ['🔴 Red', '🟠 Orange', '🟡 Yellow', '🟢 Green', '🔵 Blue', '🟣 Purple', '🌸 Pink', '⚫ Black', '⚪ White', '🟤 Brown'],
  animals: [
    '🐶 Dog',
    '🐱 Cat',
    '🐰 Rabbit',
    '🐴 Horse',
    '🦁 Lion',
    '🐯 Tiger',
    '🐘 Elephant',
    '🦒 Giraffe',
    '🐼 Panda',
    '🐧 Penguin',
    '🐬 Dolphin',
    '🐵 Monkey',
    '🦉 Owl',
    '🦊 Fox',
    '🦄 Unicorn',
    '🐢 Turtle',
  ],
  foods: [
    '🍕 Pizza',
    '🍝 Pasta',
    '🍟 Chips',
    '🍔 Burger',
    '🥞 Pancakes',
    '🐟 Fish fingers',
    '🍛 Curry',
    '🍣 Sushi',
    '🥣 Soup',
    '🍳 Eggs',
    '🍎 Apples',
    '🍓 Strawberries',
    '🍌 Bananas',
    '🍦 Ice cream',
    '🍫 Chocolate',
    '🍰 Cake',
  ],
  toys: [
    '🧸 Teddy bear',
    '🧱 Building bricks',
    '⚽ Ball',
    '🚗 Toy cars',
    '🚂 Train set',
    '🧩 Puzzles',
    '🖍️ Crayons',
    '🤖 Robot',
    '🦖 Dinosaurs',
    '🪁 Kite',
    '🚲 Bike',
    '🛴 Scooter',
    '🎲 Board games',
  ],
  jobs: [
    '🩺 Doctor',
    '📚 Teacher',
    '🚒 Firefighter',
    '🐾 Vet',
    '🚀 Astronaut',
    '🧁 Baker',
    '⚽ Footballer',
    '🎨 Artist',
    '🔬 Scientist',
    '✈️ Pilot',
    '🔨 Builder',
    '🚜 Farmer',
    '🎤 Singer',
    '🦓 Zookeeper',
  ],
  numbers: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
  seasons: ['🌷 Spring', '☀️ Summer', '🍂 Autumn', '⛄ Winter'],
  sports: [
    '⚽ Football',
    '🏊 Swimming',
    '🏃 Running',
    '💃 Dancing',
    '🎾 Tennis',
    '🚴 Cycling',
    '🤸 Gymnastics',
    '🧗 Climbing',
    '🏀 Basketball',
    '🏏 Cricket',
    '🥋 Martial arts',
    '🛹 Skateboarding',
  ],
  places: [
    '🏖️ The beach',
    '🌳 The park',
    '🦁 The zoo',
    '🌲 The woods',
    '📚 The library',
    '🏊 The swimming pool',
    '🎬 The cinema',
    '🚜 A farm',
    '🏰 A castle',
    '🛒 The shops',
    "🏡 Gran's house",
    '🎡 The funfair',
  ],
  trips: [
    '🗼 Paris',
    '🌕 The Moon',
    '🦘 Australia',
    '🗾 Japan',
    '❄️ The North Pole',
    '🐫 Egypt',
    '🗽 New York',
    '🌴 A rainforest',
    '🌋 Iceland',
    '🏔️ The Alps',
    '🦓 A safari',
    '🏝️ A desert island',
  ],
  days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  powers: [
    '🦸 Flying',
    '👻 Being invisible',
    '⚡ Super speed',
    '🐾 Talking to animals',
    '🐠 Breathing underwater',
    '⏳ Time travel',
    '💪 Super strength',
    '🧠 Reading minds',
  ],
  fears: ['🕷️ Spiders', '🌑 The dark', '🧗 Heights', '⛈️ Thunder', '🐝 Wasps', '🤡 Clowns', '🌊 Deep water', '🐍 Snakes', '🐭 Mice'],
  subjects: ['🔢 Maths', '📖 English', '🔬 Science', '🎨 Art', '⚽ PE', '🎵 Music', '🏰 History', '🌍 Geography', '💻 Computing', '🗣️ Languages'],
};

export interface Starter {
  text: string;
  /** Answers to tap, when the question has a list of them. */
  chips?: ChipSet;
}

/** Question ideas, simple for the youngest and more about stories and wishes for the oldest. */
export const startersFor: Record<Band, Starter[]> = {
  '5-7': [
    { text: "What's my favourite colour?", chips: 'colours' },
    { text: "What's my favourite animal?", chips: 'animals' },
    { text: "What's my favourite food?", chips: 'foods' },
    { text: "What's my favourite toy?", chips: 'toys' },
    { text: 'What do I want to be when I grow up?', chips: 'jobs' },
    { text: "What's my favourite number?", chips: 'numbers' },
  ],
  '8-10': [
    { text: "What's my favourite animal?", chips: 'animals' },
    { text: "What's my favourite food?", chips: 'foods' },
    { text: "What's my favourite colour?", chips: 'colours' },
    { text: 'What do I want to be when I grow up?', chips: 'jobs' },
    { text: "What's my favourite season?", chips: 'seasons' },
    { text: "What's my favourite sport?", chips: 'sports' },
    { text: "Where's my favourite place to go?", chips: 'places' },
    { text: 'Which day of the week do I like best?', chips: 'days' },
    { text: "What's my favourite number?", chips: 'numbers' },
  ],
  '11-13': [
    { text: 'Which superpower would I pick?', chips: 'powers' },
    { text: 'Where would I most like to go on holiday?', chips: 'trips' },
    { text: "What's my favourite school subject?", chips: 'subjects' },
    { text: 'What am I most scared of?', chips: 'fears' },
    { text: 'What sport or hobby do I like best?', chips: 'sports' },
    { text: "What's my favourite food?", chips: 'foods' },
    { text: "What's my favourite season?", chips: 'seasons' },
    { text: "What's a funny thing that happened to me?" },
  ],
  '14+': [
    { text: 'What was the first concert or show I went to?' },
    { text: "Where's a place I'd love to visit?", chips: 'trips' },
    { text: 'Which superpower would I rather have?', chips: 'powers' },
    { text: 'Which would I rather do on a free day?' },
    { text: "What's a funny thing that happened to me?" },
    { text: 'What did I want to be when I was little?', chips: 'jobs' },
    { text: 'What was my favourite subject at school?', chips: 'subjects' },
    { text: 'What am I most scared of?', chips: 'fears' },
  ],
};

/** The right answer someone tapped, with wrong ones picked from the same list. */
export function fromChip(set: ChipSet, chosen: string, choices: number, random = Math.random): { right: string; wrong: string[] } {
  const others = shuffle(
    chipSets[set].filter((c) => !sameAnswer(c, chosen)),
    random,
  );
  return { right: chosen, wrong: others.slice(0, choices - 1) };
}

/** Another answer from the list that isn't one of `used`, to swap a wrong answer for; null when the list has run out. */
export function anotherChip(set: ChipSet, used: string[], random = Math.random): string | null {
  const free = chipSets[set].filter((c) => !used.some((u) => sameAnswer(u, c)));
  return free.length ? pick(free, random) : null;
}
