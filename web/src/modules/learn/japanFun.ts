// Things to get the family excited about Japan: a fact for every day of the
// countdown, and a card of things to spot on the trip. Spot ids are saved on
// the server (ja.spot.torii), so never rename one.

export interface Spot {
  id: string;
  emoji: string;
  label: string;
  /** Where or how to find it. */
  hint: string;
}

/** Sixteen things to spot, as a four by four bingo card. */
export const spots: Spot[] = [
  { id: 'torii', emoji: '⛩️', label: 'Shrine gate', hint: 'Bright orange gates, called torii, at the way into a shrine.' },
  { id: 'fuji', emoji: '🗻', label: 'Mount Fuji', hint: 'Look out of the train window between Tokyo and Kyoto.' },
  { id: 'shinkansen', emoji: '🚄', label: 'Bullet train', hint: 'Long noses, very fast, and always on time.' },
  { id: 'deer', emoji: '🦌', label: 'Deer', hint: 'In Nara they wander about, and some bow for a cracker.' },
  { id: 'vending', emoji: '🥤', label: 'Vending machine', hint: 'They are everywhere, even on quiet country roads.' },
  { id: 'toilet', emoji: '🚽', label: 'Toilet with buttons', hint: 'Some have heated seats and play music. Ask a grown-up before pressing!' },
  { id: 'lucky_cat', emoji: '🐱', label: 'Lucky cat', hint: 'A waving cat in a shop window, called maneki-neko.' },
  { id: 'lantern', emoji: '🏮', label: 'Red lantern', hint: 'Hanging outside little restaurants and at temples.' },
  { id: 'sushi_train', emoji: '🍣', label: 'Sushi train', hint: 'Plates of sushi going round on a belt. The plate colour shows the price.' },
  { id: 'capsule_toys', emoji: '🧸', label: 'Capsule toys', hint: 'Rows of machines: turn the handle and a tiny toy pops out in a ball.' },
  { id: 'koi', emoji: '🐟', label: 'Koi carp', hint: 'Big orange and white fish in temple and garden ponds.' },
  { id: 'kimono', emoji: '👘', label: 'Kimono', hint: 'Someone wearing one, often in Kyoto.' },
  { id: 'castle', emoji: '🏯', label: 'Castle', hint: 'White walls and curly roofs, like Himeji or Osaka castle.' },
  { id: 'drain_cover', emoji: '🎨', label: 'Painted drain cover', hint: 'Many towns put pictures on their drain covers. Look down!' },
  { id: 'blue_light', emoji: '🚦', label: 'Blue traffic light', hint: 'The go light looks blue-green, and in Japanese it is called blue.' },
  { id: 'bowing', emoji: '🙇', label: 'Someone bowing', hint: 'People bow to say hello, thank you and sorry.' },
];

/** Every line on the card: four rows, four columns and the two diagonals. */
export const bingoLines: number[][] = [
  ...[0, 1, 2, 3].map((r) => [0, 1, 2, 3].map((c) => r * 4 + c)),
  ...[0, 1, 2, 3].map((c) => [0, 1, 2, 3].map((r) => r * 4 + c)),
  [0, 5, 10, 15],
  [3, 6, 9, 12],
];

/** A fact for each day, the same one for everyone at home. */
export const japanFacts: string[] = [
  'Japan is made of more than 14,000 islands.',
  "Mount Fuji is Japan's highest mountain, at 3,776 metres. On a clear day you can see it from Tokyo.",
  'In Nara, over a thousand deer wander the park. Some bow to visitors to ask for a deer cracker.',
  'Snow monkeys in the mountains warm up in hot springs in the winter.',
  'Some Japanese toilets have heated seats, and some play music!',
  'You take your shoes off when you go into a Japanese home, and wear slippers inside.',
  'The first bullet train ran in 1964, just in time for the Tokyo Olympics.',
  'The fastest bullet trains go 320 km/h: nearly three times as fast as a car on the motorway.',
  "A bullet train's long nose was shaped like a kingfisher's beak, to make it quieter in tunnels.",
  'Cleaners tidy a whole bullet train in about seven minutes, then bow to the passengers.',
  'Japanese has three ways of writing: hiragana, katakana and kanji.',
  'Your name can be written in katakana, the letters Japanese uses for words from other countries.',
  "Nihon, Japan's name, means where the sun comes from. Its flag is a red sun.",
  'Japan has millions of vending machines. Some sell hot soup in a can!',
  'At a sushi train, plates go round on a belt and you take the ones you like.',
  'Many restaurants show plastic models of their food in the window, so you can point at what you want.',
  'People bow to say hello, thank you and sorry. A deeper bow is extra polite.',
  'Before eating, everyone says itadakimasu, which is a thank you for the food.',
  'Japanese children help to clean their own classrooms at school.',
  'In Kyoto there are about 1,600 temples.',
  'Fushimi Inari in Kyoto has thousands of orange gates, one after another up a mountain.',
  'A waving lucky cat in a shop window is meant to bring good luck.',
  'Folding a thousand paper cranes is said to make a wish come true.',
  'Origami means folding paper.',
  "On Children's Day, 5 May, families fly windsocks shaped like carp fish.",
  "In spring, families have picnics under the cherry blossom. It's called hanami.",
  'In the north, Sapporo has a snow festival with giant snow sculptures.',
  'In the far south, Okinawa has coral reefs and sea turtles.',
  'Japan has more than a hundred volcanoes, and thousands of hot springs called onsen.',
  'Tokyo is one of the biggest cities in the world, with about 14 million people.',
  'Millions of people pass through Shinjuku station in Tokyo every day.',
  'Many stations play a little tune when a train is about to leave.',
  'Taxi doors in Japan open and close by themselves.',
  'Many towns paint pictures on their drain covers. Look down as you walk!',
  'The go light at traffic lights is called blue in Japanese, and it looks quite blue too.',
  'A kotatsu is a low table with a heater underneath and a blanket to snuggle under.',
  'The 5 yen coin has a hole in the middle and is thought to be lucky.',
  'Capsule toy machines hold thousands of tiny toys. Turn the handle to get a surprise.',
  "On New Year's Eve people eat long soba noodles, for a long life.",
  "Dreaming of Mount Fuji, a hawk or an aubergine on New Year's night is said to be lucky.",
  "Green tea is so loved in Japan that there's green tea ice cream, green tea sweets and green tea cake.",
  'Onigiri are rice balls wrapped in seaweed, sold in every corner shop.',
  'Sumo wrestlers throw salt into the ring before a bout, to make it pure.',
  'Some islands in Japan have more cats than people.',
];

/** Today's fact, picked by the date so everyone at home gets the same one. */
export function factFor(date: Date): string {
  const day = Math.floor((date.getTime() - date.getTimezoneOffset() * 60_000) / 86_400_000);
  return japanFacts[day % japanFacts.length];
}

/** Whole days from today to the trip, by the calendar, not the clock. */
export function sleepsUntil(trip: string, today: Date): number {
  const [y, m, d] = trip.split('-').map(Number);
  const start = Date.UTC(y, m - 1, d);
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((start - now) / 86_400_000);
}
