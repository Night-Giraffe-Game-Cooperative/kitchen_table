// Ideas for what to draw, by age: one simple thing for the youngest, silly
// ideas, then bigger scenes, then ideas that are hard to draw at all.
import type { Band } from '../bands';
import type { Lesson } from '../learn';

export const promptsFor: Record<Band, string[]> = {
  '5-7': [
    'a cat',
    'a big house',
    'a rainbow',
    'a happy sun',
    'a fish',
    'a flower',
    'a car',
    'a birthday cake',
    'a snowman',
    'a teddy bear',
    'a tree',
    'a dog',
    'a boat',
    'an ice cream',
    'a butterfly',
    'a rocket',
    'a castle',
    'a dinosaur',
    'a unicorn',
    'a funny face',
  ],
  '8-10': [
    'a castle in the clouds',
    'a dog riding a bicycle',
    'the best sandwich ever',
    'a dragon who wants a friend',
    'our house as a spaceship',
    'a cat wearing a crown',
    'a monster who loves flowers',
    'a picnic on the moon',
    'a unicorn at the seaside',
    'a robot making pancakes',
    'a teddy bear on holiday',
    'a tree with a door in it',
    'the silliest hat',
    'a snail in a hurry',
    'a pirate ship in the bath',
    'a whale in the sky',
    'a birthday cake for a giraffe',
    'a snowman in summer',
    'a superhero hamster',
    'the garden at night',
    'a penguin at the shops',
    'a rainbow train',
    'grandma as a wizard',
    'a sleepy owl',
    'a giant strawberry',
    'a bear having a bath',
  ],
  '11-13': [
    'a library for dragons',
    'the inside of a volcano',
    'a city under the sea',
    'a robot learning to dance',
    'a haunted lighthouse',
    'a village of treehouses',
    'a traffic jam of animals',
    'the view from a hot air balloon',
    'a shop that sells weather',
    'a knight who is scared of the dark',
    'an octopus doing homework',
    'a castle made of sweets',
    'a train going through a jungle',
    'a giant in a tiny house',
    'our school as a spaceship',
    'a market on the moon',
  ],
  '14+': [
    'the feeling of Monday morning',
    'time running out',
    'a secret',
    'the sound of thunder',
    "a lost sock's adventure",
    'the internet as a place',
    'being brave',
    'a bad hair day',
    'the last day of summer',
    'an awkward silence',
    'a city that never sleeps',
    'the smell of rain',
    "a song you can't stop humming",
    'gravity taking a day off',
    'a dream you half remember',
    'the middle of nowhere',
  ],
};

/** Whether this is one of the built-in ideas, so changing the age band can swap it. */
export const isPrompt = (text: string) => Object.values(promptsFor).some((list) => list.includes(text.trim()));

export const doodleBands: Record<Band, string> = {
  '5-7': 'Simple things to draw, like a cat or a rainbow.',
  '8-10': 'Silly ideas to draw, like a dog riding a bicycle.',
  '11-13': 'Bigger scenes to draw, like a city under the sea.',
  '14+': 'Tricky ideas to draw, like the feeling of Monday morning.',
};

const bigShapes: Lesson = {
  art: '⭕',
  title: 'Big shapes first',
  text: 'Start with big shapes, like a circle for a head or a box for a house, then add the details. Nobody needs a masterpiece.',
};

export const togetherBasics: Lesson[] = [
  { art: '🖍️', title: 'The aim', text: 'Draw one big picture together. Everyone draws on the same page at the same time, and sees each other drawing.' },
  { art: '🎨', title: 'Pens and colours', text: 'Pick a pen, a size and a colour from the tools, then draw with your finger.' },
  bigShapes,
  { art: '🤝', title: 'Sharing the page', text: "Take a part each: the sky, the ground, the people. When it's done, press It's finished! Share it." },
];

export const duelBasics: Lesson[] = [
  { art: '✏️', title: 'The aim', text: 'Everyone draws the same thing in secret. Then the pictures are shown and everyone gives a star to their favourite.' },
  bigShapes,
  { art: '💡', title: 'Make it yours', text: 'A funny or surprising idea often gets more stars than the neatest drawing.' },
  { art: '🌟', title: 'Stars', text: "Give your star to the picture you like most. You can't star your own, and the most stars wins." },
];

export const telephoneBasics: Lesson[] = [
  { art: '📞', title: 'The aim', text: 'Words become a drawing, the drawing becomes a guess, and on it goes. At the end, see how far it travelled.' },
  { art: '✏️', title: 'Drawing', text: 'Draw the main thing big and simple, so the next person has a chance of guessing it.' },
  { art: '🤔', title: 'Guessing', text: "You only see the step just before yours. Say what you really see: the muddles are the fun part." },
  { art: '🔁', title: 'Taking turns', text: 'Nobody does two steps in a row, so someone else always goes in between.' },
];
