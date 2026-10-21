// Words for Word Garden, with a picture to help younger readers, in British
// spelling. Most are words a five-year-old might know; the ones marked hard
// are for older players, from 11 up.
import type { Band } from '../bands';

export interface Word {
  word: string;
  emoji: string;
  hard?: boolean;
}

const hard = (list: [string, string][]): Word[] => list.map(([word, emoji]) => ({ word, emoji, hard: true }));

export const categories: Record<string, { label: string; hint: string; words: Word[] }> = {
  animals: {
    label: 'Animals',
    hint: 'An animal',
    words: [
      { word: 'cat', emoji: '🐱' },
      { word: 'dog', emoji: '🐶' },
      { word: 'pig', emoji: '🐷' },
      { word: 'cow', emoji: '🐮' },
      { word: 'fox', emoji: '🦊' },
      { word: 'owl', emoji: '🦉' },
      { word: 'bear', emoji: '🐻' },
      { word: 'frog', emoji: '🐸' },
      { word: 'duck', emoji: '🦆' },
      { word: 'lion', emoji: '🦁' },
      { word: 'fish', emoji: '🐟' },
      { word: 'horse', emoji: '🐴' },
      { word: 'sheep', emoji: '🐑' },
      { word: 'mouse', emoji: '🐭' },
      { word: 'snail', emoji: '🐌' },
      { word: 'whale', emoji: '🐳' },
      { word: 'tiger', emoji: '🐯' },
      { word: 'zebra', emoji: '🦓' },
      { word: 'rabbit', emoji: '🐰' },
      { word: 'monkey', emoji: '🐵' },
      { word: 'turtle', emoji: '🐢' },
      { word: 'parrot', emoji: '🦜' },
      { word: 'penguin', emoji: '🐧' },
      { word: 'giraffe', emoji: '🦒' },
      { word: 'dolphin', emoji: '🐬' },
      { word: 'hedgehog', emoji: '🦔' },
      { word: 'elephant', emoji: '🐘' },
      { word: 'butterfly', emoji: '🦋' },
      { word: 'crocodile', emoji: '🐊' },
      { word: 'unicorn', emoji: '🦄' },
      ...hard([
        ['lizard', '🦎'], ['octopus', '🐙'], ['squirrel', '🐿️'], ['hamster', '🐹'], ['peacock', '🦚'], ['gorilla', '🦍'],
        ['leopard', '🐆'], ['scorpion', '🦂'], ['mosquito', '🦟'], ['kangaroo', '🦘'], ['flamingo', '🦩'], ['raccoon', '🦝'],
        ['lobster', '🦞'], ['ladybird', '🐞'], ['caterpillar', '🐛'], ['orangutan', '🦧'], ['rhinoceros', '🦏'], ['hippopotamus', '🦛'],
        ['badger', '🦡'], ['otter', '🦦'], ['sloth', '🦥'], ['beaver', '🦫'], ['mammoth', '🦣'], ['tarantula', '🕷️'],
      ]),
    ],
  },
  food: {
    label: 'Food',
    hint: 'Something to eat',
    words: [
      { word: 'egg', emoji: '🥚' },
      { word: 'pie', emoji: '🥧' },
      { word: 'jam', emoji: '🫙' },
      { word: 'cake', emoji: '🎂' },
      { word: 'pear', emoji: '🍐' },
      { word: 'soup', emoji: '🍲' },
      { word: 'bread', emoji: '🍞' },
      { word: 'apple', emoji: '🍎' },
      { word: 'grape', emoji: '🍇' },
      { word: 'pizza', emoji: '🍕' },
      { word: 'lemon', emoji: '🍋' },
      { word: 'honey', emoji: '🍯' },
      { word: 'cheese', emoji: '🧀' },
      { word: 'banana', emoji: '🍌' },
      { word: 'carrot', emoji: '🥕' },
      { word: 'cherry', emoji: '🍒' },
      { word: 'cookie', emoji: '🍪' },
      { word: 'popcorn', emoji: '🍿' },
      { word: 'pancake', emoji: '🥞' },
      { word: 'sandwich', emoji: '🥪' },
      { word: 'broccoli', emoji: '🥦' },
      { word: 'pineapple', emoji: '🍍' },
      { word: 'strawberry', emoji: '🍓' },
      { word: 'spaghetti', emoji: '🍝' },
      { word: 'doughnut', emoji: '🍩' },
      ...hard([
        ['avocado', '🥑'], ['cucumber', '🥒'], ['aubergine', '🍆'], ['pretzel', '🥨'], ['croissant', '🥐'], ['sweetcorn', '🌽'],
        ['coconut', '🥥'], ['mango', '🥭'], ['waffle', '🧇'], ['dumpling', '🥟'], ['burrito', '🌯'], ['noodles', '🍜'],
        ['blueberry', '🫐'], ['watermelon', '🍉'], ['tangerine', '🍊'], ['chocolate', '🍫'], ['lollipop', '🍭'], ['omelette', '🍳'],
        ['baguette', '🥖'], ['peanut', '🥜'], ['garlic', '🧄'], ['onion', '🧅'], ['sausage', '🌭'], ['kiwifruit', '🥝'],
      ]),
    ],
  },
  home: {
    label: 'At home',
    hint: 'Something at home',
    words: [
      { word: 'bed', emoji: '🛏️' },
      { word: 'cup', emoji: '☕' },
      { word: 'key', emoji: '🔑' },
      { word: 'door', emoji: '🚪' },
      { word: 'lamp', emoji: '💡' },
      { word: 'sofa', emoji: '🛋️' },
      { word: 'book', emoji: '📖' },
      { word: 'sock', emoji: '🧦' },
      { word: 'chair', emoji: '🪑' },
      { word: 'clock', emoji: '🕰️' },
      { word: 'brush', emoji: '🪥' },
      { word: 'spoon', emoji: '🥄' },
      { word: 'teddy', emoji: '🧸' },
      { word: 'pillow', emoji: '🛌' },
      { word: 'mirror', emoji: '🪞' },
      { word: 'window', emoji: '🪟' },
      { word: 'kettle', emoji: '🫖' },
      { word: 'bathtub', emoji: '🛁' },
      { word: 'scissors', emoji: '✂️' },
      { word: 'umbrella', emoji: '☂️' },
      { word: 'toothbrush', emoji: '🪥' },
      { word: 'television', emoji: '📺' },
      ...hard([
        ['candle', '🕯️'], ['basket', '🧺'], ['bucket', '🪣'], ['ladder', '🪜'], ['hammer', '🔨'], ['sponge', '🧽'],
        ['telephone', '☎️'], ['computer', '💻'], ['keyboard', '⌨️'], ['calendar', '📅'], ['thermometer', '🌡️'], ['magnet', '🧲'],
        ['battery', '🔋'], ['envelope', '✉️'], ['paintbrush', '🖌️'], ['microscope', '🔬'], ['telescope', '🔭'], ['headphones', '🎧'],
        ['guitar', '🎸'], ['trumpet', '🎺'], ['violin', '🎻'], ['saxophone', '🎷'], ['broom', '🧹'], ['compass', '🧭'],
      ]),
    ],
  },
  outside: {
    label: 'Outside',
    hint: 'Something outside',
    words: [
      { word: 'sun', emoji: '☀️' },
      { word: 'sky', emoji: '🌤️' },
      { word: 'bee', emoji: '🐝' },
      { word: 'tree', emoji: '🌳' },
      { word: 'rain', emoji: '🌧️' },
      { word: 'moon', emoji: '🌙' },
      { word: 'star', emoji: '⭐' },
      { word: 'leaf', emoji: '🍃' },
      { word: 'snow', emoji: '❄️' },
      { word: 'cloud', emoji: '☁️' },
      { word: 'beach', emoji: '🏖️' },
      { word: 'grass', emoji: '🌱' },
      { word: 'river', emoji: '🏞️' },
      { word: 'flower', emoji: '🌸' },
      { word: 'puddle', emoji: '💧' },
      { word: 'garden', emoji: '🏡' },
      { word: 'rainbow', emoji: '🌈' },
      { word: 'mountain', emoji: '⛰️' },
      { word: 'snowman', emoji: '☃️' },
      { word: 'sunflower', emoji: '🌻' },
      { word: 'mushroom', emoji: '🍄' },
      { word: 'acorn', emoji: '🌰' },
      ...hard([
        ['volcano', '🌋'], ['desert', '🏜️'], ['island', '🏝️'], ['lightning', '🌩️'], ['tornado', '🌪️'], ['cactus', '🌵'],
        ['tulip', '🌷'], ['hibiscus', '🌺'], ['seedling', '🌱'], ['comet', '☄️'], ['planet', '🪐'], ['galaxy', '🌌'],
        ['thunder', '⛈️'], ['fountain', '⛲'], ['bonfire', '🔥'], ['castle', '🏰'], ['evergreen', '🌲'], ['snowflake', '❄️'],
        ['iceberg', '🧊'], ['meadow', '🌼'], ['sunrise', '🌅'], ['moonlight', '🌕'], ['blossom', '🌸'], ['horizon', '🌄'],
      ]),
    ],
  },
  moving: {
    label: 'Things that go',
    hint: 'Something that goes',
    words: [
      { word: 'bus', emoji: '🚌' },
      { word: 'car', emoji: '🚗' },
      { word: 'van', emoji: '🚐' },
      { word: 'boat', emoji: '⛵' },
      { word: 'bike', emoji: '🚲' },
      { word: 'kite', emoji: '🪁' },
      { word: 'ship', emoji: '🚢' },
      { word: 'train', emoji: '🚂' },
      { word: 'plane', emoji: '✈️' },
      { word: 'truck', emoji: '🚚' },
      { word: 'rocket', emoji: '🚀' },
      { word: 'tractor', emoji: '🚜' },
      { word: 'scooter', emoji: '🛴' },
      { word: 'balloon', emoji: '🎈' },
      { word: 'helicopter', emoji: '🚁' },
      { word: 'skateboard', emoji: '🛹' },
      { word: 'firetruck', emoji: '🚒' },
      ...hard([
        ['ambulance', '🚑'], ['motorbike', '🏍️'], ['bicycle', '🚲'], ['aeroplane', '✈️'], ['canoe', '🛶'], ['parachute', '🪂'],
        ['tram', '🚊'], ['taxi', '🚕'], ['speedboat', '🚤'], ['ferry', '⛴️'], ['satellite', '🛰️'], ['rollerskate', '🛼'],
        ['locomotive', '🚂'], ['monorail', '🚝'], ['sledge', '🛷'], ['minibus', '🚐'], ['lorry', '🚚'], ['gondola', '🚡'],
        ['trolleybus', '🚎'], ['spaceship', '🚀'], ['sailboat', '⛵'], ['wheelchair', '🦽'], ['funicular', '🚞'], ['rickshaw', '🛺'],
      ]),
    ],
  },
};

/** Word sizes, from games made before age bands. */
export type Length = 'short' | 'any' | 'long';

/**
 * Whether a word suits an age band: short everyday words for 5–7, everyday
 * words of four to six letters for 8–10, longer ones and some harder ones for
 * 11–13, and the harder and longest ones for 14 and up.
 */
export function fits(w: Word, band: Band): boolean {
  const n = w.word.length;
  switch (band) {
    case '5-7':
      return !w.hard && n <= 4;
    case '8-10':
      return !w.hard && n >= 4 && n <= 6;
    case '11-13':
      return n >= 6 && n <= 9;
    case '14+':
      return w.hard ? n >= 6 : n >= 9;
  }
}

/** The words of a category (or 'mixed' for all of them) for an age band, or a word size from an older game. */
export function wordsFor(category: string, size: Band | Length): (Word & { category: string })[] {
  const cats = category === 'mixed' || !categories[category] ? Object.keys(categories) : [category];
  const keep = (w: Word) =>
    size === 'short'
      ? !w.hard && w.word.length <= 5
      : size === 'long'
        ? !w.hard && w.word.length >= 6
        : size === 'any'
          ? !w.hard
          : fits(w, size);
  return cats.flatMap((c) => categories[c].words.filter(keep).map((w) => ({ ...w, category: c })));
}
