// Getting about in Japan: bullet train know-how for everyone, and road signs
// and the rules of the road for the grown-ups who'll drive. Ids are saved on
// the server (ja.road.stop, ja.test.road), so never rename one.

import type { ReactNode } from 'react';

export interface Question {
  id: string;
  /** What it's about, for the know-how list. */
  title: string;
  emoji: string;
  q: string;
  right: string;
  wrong: string[];
  /** Why, shown after answering and in the know-how list. */
  why: string;
  /** A sign to look at, for the sign questions. */
  picture?: ReactNode;
}

export interface RoadSign {
  id: string;
  /** What it means, short enough to be a quiz answer. */
  en: string;
  /** Its Japanese name, and how to say it. */
  jp: string;
  say: string;
  roman: string;
  /** What the voice reads. */
  speak: string;
  /** What to do, and how it differs from home. */
  means: string;
  picture: ReactNode;
}

/** Passing the road test or the bullet train quiz is saved under these. */
export const ROAD_TEST = 'test.road';
export const TRAIN_QUIZ = 'test.trains';

// Real sign colours, the same in light and dark.
const RED = '#c8102e';
const BLUE = '#1f4e9c';
const GREEN = '#00704a';
const YELLOW = '#f6c400';
const PURPLE = '#6b3b96';
const INK = '#1f1f1f';
const EDGE = 'rgba(0, 0, 0, 0.25)';

const font = { fontFamily: 'inherit', fontWeight: 700, textAnchor: 'middle' as const };

function Triangle({ big, small }: { big: string; small: string }) {
  return (
    <>
      <polygon points="4,10 96,10 50,94" fill="#fff" stroke={EDGE} strokeWidth="1" strokeLinejoin="round" />
      <polygon points="12,15 88,15 50,85" fill={RED} />
      <text x="50" y="35" fill="#fff" fontSize="16" {...font}>
        {big}
      </text>
      <text x="50" y="50" fill="#fff" fontSize="10" {...font}>
        {small}
      </text>
    </>
  );
}

function Ring({ fill, children }: { fill: string; children?: ReactNode }) {
  return (
    <>
      <circle cx="50" cy="50" r="48" fill="#fff" stroke={EDGE} strokeWidth="1" />
      <circle cx="50" cy="50" r="42" fill={fill} stroke={RED} strokeWidth="9" />
      {children}
    </>
  );
}

function Board({ fill, children }: { fill: string; children: ReactNode }) {
  return (
    <>
      <rect x="4" y="20" width="92" height="60" rx="7" fill={fill} stroke="#fff" strokeWidth="2.5" />
      {children}
    </>
  );
}

function Lit({ char, colour }: { char: string; colour: string }) {
  return (
    <>
      <rect x="14" y="10" width="72" height="80" rx="8" fill={INK} />
      <text x="50" y="68" fill={colour} fontSize="50" {...font}>
        {char}
      </text>
    </>
  );
}

export const roadSigns: RoadSign[] = [
  {
    id: 'stop',
    en: 'Stop',
    jp: '止まれ',
    say: 'toh-mah-reh',
    roman: 'tomare',
    speak: 'とまれ',
    means: 'Stop completely at the white line, even when the road looks clear. It is an upside-down red triangle, not an octagon.',
    picture: <Triangle big="止まれ" small="STOP" />,
  },
  {
    id: 'slow',
    en: 'Slow down',
    jp: '徐行',
    say: 'joh-koh',
    roman: 'jokō',
    speak: 'じょこう',
    means: 'Go slowly enough to stop at once. Often by schools and on narrow lanes.',
    picture: <Triangle big="徐行" small="SLOW" />,
  },
  {
    id: 'no_entry',
    en: 'No entry',
    jp: '車両進入禁止',
    say: 'shah-ryoh shin-new kin-shee',
    roman: 'sharyō shinnyū kinshi',
    speak: 'しゃりょう しんにゅう きんし',
    means: "No driving in from this side. The same as at home: you'll see it at the wrong end of one-way streets.",
    picture: (
      <>
        <circle cx="50" cy="50" r="48" fill="#fff" stroke={EDGE} strokeWidth="1" />
        <circle cx="50" cy="50" r="44" fill={RED} />
        <rect x="17" y="42" width="66" height="16" fill="#fff" />
      </>
    ),
  },
  {
    id: 'speed',
    en: 'Speed limit 40 km/h',
    jp: '最高速度',
    say: 'sai-koh soh-koo-doh',
    roman: 'saikō sokudo',
    speak: 'さいこう そくど',
    means: 'Blue numbers in a red ring are the most you may go, in km/h. 40 km/h is about 25 mph.',
    picture: (
      <Ring fill="#fff">
        <text x="50" y="64" fill={BLUE} fontSize="40" {...font} fontWeight={800}>
          40
        </text>
      </Ring>
    ),
  },
  {
    id: 'min_speed',
    en: 'Minimum speed 50 km/h',
    jp: '最低速度',
    say: 'sai-tay soh-koo-doh',
    roman: 'saitei sokudo',
    speak: 'さいてい そくど',
    means: 'A white number, underlined, on blue is the slowest you may go. Mostly on expressways.',
    picture: (
      <>
        <circle cx="50" cy="50" r="48" fill="#fff" stroke={EDGE} strokeWidth="1" />
        <circle cx="50" cy="50" r="44" fill={BLUE} />
        <text x="50" y="60" fill="#fff" fontSize="36" {...font} fontWeight={800}>
          50
        </text>
        <rect x="30" y="66" width="40" height="5" fill="#fff" />
      </>
    ),
  },
  {
    id: 'no_parking',
    en: 'No parking',
    jp: '駐車禁止',
    say: 'choo-shah kin-shee',
    roman: 'chūsha kinshi',
    speak: 'ちゅうしゃ きんし',
    means: 'You may stop for a moment to let someone out, but not park. One red line.',
    picture: (
      <Ring fill={BLUE}>
        <line x1="20" y1="20" x2="80" y2="80" stroke={RED} strokeWidth="9" />
      </Ring>
    ),
  },
  {
    id: 'no_stopping',
    en: 'No stopping or parking',
    jp: '駐停車禁止',
    say: 'choo-tay-shah kin-shee',
    roman: 'chūteisha kinshi',
    speak: 'ちゅうていしゃ きんし',
    means: "Don't stop at all, not even to let someone out. Two red lines make a cross.",
    picture: (
      <Ring fill={BLUE}>
        <line x1="20" y1="20" x2="80" y2="80" stroke={RED} strokeWidth="9" />
        <line x1="80" y1="20" x2="20" y2="80" stroke={RED} strokeWidth="9" />
      </Ring>
    ),
  },
  {
    id: 'one_way',
    en: 'One way',
    jp: '一方通行',
    say: 'ip-poh tsoo-koh',
    roman: 'ippō tsūkō',
    speak: 'いっぽう つうこう',
    means: 'Traffic only goes the way of the arrow. Look out for them in narrow town streets.',
    picture: (
      <>
        <rect x="3" y="26" width="94" height="48" rx="4" fill={BLUE} stroke="#fff" strokeWidth="2.5" />
        <polygon points="9,41 66,41 66,31 91,50 66,69 66,59 9,59" fill="#fff" />
        <text x="38" y="54" fill={BLUE} fontSize="11" {...font}>
          一方通行
        </text>
      </>
    ),
  },
  {
    id: 'crossing',
    en: 'Pedestrian crossing',
    jp: '横断歩道',
    say: 'oh-dan hoh-doh',
    roman: 'ōdan hodō',
    speak: 'おうだん ほどう',
    means: 'A crossing is here. Stop for anyone waiting to cross.',
    picture: (
      <>
        <rect x="4" y="4" width="92" height="92" rx="7" fill={BLUE} />
        <polygon points="50,12 91,86 9,86" fill="#fff" />
        <circle cx="52" cy="40" r="5" fill={INK} />
        <path
          d="M51 47 L48 62 L42 73 M48 62 L56 72 M50 51 L42 58 M50 51 L59 56"
          stroke={INK}
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <g fill={INK}>
          <rect x="22" y="77" width="8" height="4" />
          <rect x="34" y="77" width="8" height="4" />
          <rect x="46" y="77" width="8" height="4" />
          <rect x="58" y="77" width="8" height="4" />
          <rect x="70" y="77" width="8" height="4" />
        </g>
      </>
    ),
  },
  {
    id: 'railway',
    en: 'Level crossing ahead',
    jp: '踏切あり',
    say: 'foo-mee-kee-ree ah-ree',
    roman: 'fumikiri ari',
    speak: 'ふみきり あり',
    means: 'A railway crossing is coming. Stop before it, look and listen, even with the barriers up.',
    picture: (
      <>
        <rect x="17" y="17" width="66" height="66" rx="5" transform="rotate(45 50 50)" fill={YELLOW} stroke={INK} strokeWidth="3" />
        <g fill={INK}>
          <rect x="35" y="46" width="26" height="12" rx="2" />
          <rect x="58" y="38" width="12" height="20" rx="1" />
          <rect x="39" y="39" width="5" height="8" />
          <rect x="31" y="56" width="41" height="4" />
          <circle cx="41" cy="63" r="4" />
          <circle cx="51" cy="63" r="4" />
          <circle cx="63" cy="63" r="4.5" />
        </g>
      </>
    ),
  },
  {
    id: 'no_uturn',
    en: 'No U-turns',
    jp: '転回禁止',
    say: 'ten-kai kin-shee',
    roman: 'tenkai kinshi',
    speak: 'てんかい きんし',
    means: 'No turning round in the road here.',
    picture: (
      <Ring fill="#fff">
        <path d="M38 74 V46 A12 12 0 0 1 62 46 V56" stroke={INK} strokeWidth="7" fill="none" />
        <polygon points="53,55 71,55 62,69" fill={INK} />
        <line x1="21" y1="21" x2="79" y2="79" stroke={RED} strokeWidth="7" />
      </Ring>
    ),
  },
  {
    id: 'exit',
    en: 'Expressway exit',
    jp: '出口',
    say: 'deh-goo-chee',
    roman: 'deguchi',
    speak: 'でぐち',
    means: 'Expressway signs are green. Exits are named, often in English too, so know the name of yours.',
    picture: (
      <Board fill={GREEN}>
        <text x="50" y="53" fill="#fff" fontSize="24" {...font}>
          出口
        </text>
        <text x="50" y="70" fill="#fff" fontSize="12" {...font}>
          EXIT
        </text>
      </Board>
    ),
  },
  {
    id: 'etc',
    en: 'ETC card lane only',
    jp: 'ETC専用',
    say: 'ee-tee-shee sen-yoh',
    roman: "ETC sen'yō",
    speak: 'イーティーシー せんよう',
    means: "Purple toll lanes open only for cars with an ETC card in the reader. Without one, don't go in.",
    picture: (
      <Board fill={PURPLE}>
        <text x="50" y="52" fill="#fff" fontSize="24" {...font}>
          ETC
        </text>
        <text x="50" y="70" fill="#fff" fontSize="14" {...font}>
          専用
        </text>
      </Board>
    ),
  },
  {
    id: 'general',
    en: 'Pay at the booth',
    jp: '一般',
    say: 'ip-pan',
    roman: 'ippan',
    speak: 'いっぱん',
    means: 'The green toll lanes, for paying by cash or card when you have no ETC card.',
    picture: (
      <Board fill={GREEN}>
        <text x="50" y="62" fill="#fff" fontSize="28" {...font}>
          一般
        </text>
      </Board>
    ),
  },
  {
    id: 'full',
    en: 'Car park full',
    jp: '満車',
    say: 'man-shah',
    roman: 'mansha',
    speak: 'まんしゃ',
    means: 'Lit up outside a car park when there are no spaces left.',
    picture: <Lit char="満" colour="#ff4d3d" />,
  },
  {
    id: 'space',
    en: 'Spaces free',
    jp: '空車',
    say: 'koo-shah',
    roman: 'kūsha',
    speak: 'くうしゃ',
    means: 'Spaces free in the car park. In a taxi window, it means the taxi is free to hail.',
    picture: <Lit char="空" colour="#3ddc84" />,
  },
  {
    id: 'beginner',
    en: 'New driver on board',
    jp: '初心者マーク',
    say: 'shoh-shin-shah mah-koo',
    roman: 'shoshinsha māku',
    speak: 'しょしんしゃ マーク',
    means: 'The driver passed their test less than a year ago. Cutting in front of them or crowding them is an offence.',
    picture: (
      <>
        <polygon points="20,14 50,32 50,90 20,64" fill={YELLOW} stroke={INK} strokeWidth="1.5" strokeLinejoin="round" />
        <polygon points="50,32 80,14 80,64 50,90" fill="#2e9e3e" stroke={INK} strokeWidth="1.5" strokeLinejoin="round" />
      </>
    ),
  },
];

/** The rules of the road that catch visitors out. */
export const roadRules: Question[] = [
  {
    id: 'side',
    title: 'Drive on the left',
    emoji: '⬅️',
    q: 'Which side of the road do they drive on in Japan?',
    right: 'The left, like at home',
    wrong: ['The right', 'Either, on quiet roads'],
    why: 'The left, with the steering wheel on the right, just like the UK.',
  },
  {
    id: 'licence',
    title: 'Bring a permit',
    emoji: '🪪',
    q: 'What do you need to drive a hire car with a UK licence?',
    right: 'Your licence and an International Driving Permit',
    wrong: ['Just your UK licence', 'A Japanese licence'],
    why: "Japan takes the 1949 International Driving Permit together with your licence, for up to a year after you arrive. Get it in the UK before you go: you can't get one in Japan.",
  },
  {
    id: 'level_crossing',
    title: 'Stop at every level crossing',
    emoji: '🚃',
    q: 'You reach a level crossing and the barriers are up. What do you do?',
    right: 'Stop, look and listen, then cross',
    wrong: ['Cross carefully without stopping', 'Sound the horn and cross'],
    why: 'You must stop before every level crossing, even with the barriers up, unless it has its own traffic lights on green.',
  },
  {
    id: 'red_turn',
    title: 'No turning on red',
    emoji: '🚦',
    q: 'The light is red and the road is clear. Can you turn left?',
    right: 'No, only on a green light or a green arrow',
    wrong: ['Yes, after stopping', 'Yes, if nobody is crossing'],
    why: 'There is no turning on red. A green arrow under a red light lets you go the way it points.',
  },
  {
    id: 'speed',
    title: 'Speeds are in km/h',
    emoji: '⏱️',
    q: "No sign says how fast. What's the limit on an ordinary road?",
    right: '60 km/h (about 37 mph)',
    wrong: ['60 mph', '100 km/h'],
    why: 'Without a sign it is 60 km/h on ordinary roads, and usually 100 km/h on expressways. Signs and speedometers are in km/h.',
  },
  {
    id: 'drink',
    title: "Don't drink at all",
    emoji: '🍶',
    q: 'How much can the driver drink?',
    right: 'Nothing',
    wrong: ['One small beer', 'The same as in the UK'],
    why: "The limit is less than half of England's and the penalties are harsh. Passengers who knew the driver had been drinking can be punished too.",
  },
  {
    id: 'child_seat',
    title: 'Child seats',
    emoji: '🧒',
    q: 'Who must ride in a child seat in Japan?',
    right: 'Children under 6',
    wrong: ['Children under 3', 'Nobody, it is up to you'],
    why: "Under 6 must, by Japanese law. The UK's rule (up to 12 or 135 cm) is stricter, so keep to that. Book seats with the hire car.",
  },
  {
    id: 'belts',
    title: 'Belts in every seat',
    emoji: '🔒',
    q: 'Who must wear a seat belt?',
    right: 'Everyone, front and back',
    wrong: ['Only the driver', 'Only the front seats'],
    why: 'Everyone, in every seat, just like at home.',
  },
  {
    id: 'pedestrians',
    title: 'Stop for people crossing',
    emoji: '🚶',
    q: 'At a crossing with no lights, someone is waiting to cross. What do you do?',
    right: 'Stop and let them cross',
    wrong: ['Slow down and drive round them', 'Only stop for children'],
    why: 'Drivers must stop for anyone waiting at a crossing. Watch for people and bikes when turning too.',
  },
  {
    id: 'right_turn',
    title: 'Turning right',
    emoji: '↪️',
    q: 'Turning right at a junction, who do you give way to?',
    right: 'Traffic coming the other way, and people crossing',
    wrong: ['Nobody, you have priority', 'Only buses'],
    why: 'Just like at home: wait for a gap in oncoming traffic, then watch for people crossing the road you turn into.',
  },
  {
    id: 'phone',
    title: 'Hands off the phone',
    emoji: '📵',
    q: 'Can you talk on a phone held in your hand while driving?',
    right: 'No, hands-free only',
    wrong: ['Yes, on quiet roads', 'Yes, if you drive slowly'],
    why: 'Holding a phone while driving brings big fines and points, and far worse if it causes an accident.',
  },
  {
    id: 'horn',
    title: 'Say thanks with your hazards',
    emoji: '🙏',
    q: 'Someone lets you in. How do drivers usually say thank you?',
    right: 'Two quick blinks of the hazard lights',
    wrong: ['A toot of the horn', 'Flashing the headlights'],
    why: 'A blink of the hazards is the usual thanks. The horn is only for danger, or where a sign tells you to use it.',
  },
  {
    id: 'tolls',
    title: 'Toll gates',
    emoji: '🛣️',
    q: 'Your hire car has no ETC card. Which toll lane do you use?',
    right: 'A green 一般 lane',
    wrong: ['A purple ETC lane', 'Any lane'],
    why: 'The ETC-only barrier stays shut without a card. Use 一般 (general) to pay by cash or card. Hire companies often lend an ETC card: ask for one.',
  },
  {
    id: 'parking',
    title: 'Parking',
    emoji: '🅿️',
    q: 'Where can you park in town?',
    right: 'In a car park, like a coin car park',
    wrong: ['On the street outside the shop', 'Half on the pavement'],
    why: 'Parking on the street is mostly not allowed. Small coin car parks are everywhere: you pay at the machine before you drive off.',
  },
  {
    id: 'emergency',
    title: 'Emergency numbers',
    emoji: '☎️',
    q: 'Which number calls the police in Japan?',
    right: '110',
    wrong: ['999', '119'],
    why: "110 for the police, 119 for fire and ambulance. 999 doesn't work there.",
  },
];

/** Bullet train know-how, for the whole family. */
export const trainQuestions: Question[] = [
  {
    id: 'speed',
    title: 'Fast!',
    emoji: '💨',
    q: 'How fast do the fastest bullet trains go?',
    right: '320 km/h (200 mph)',
    wrong: ['100 km/h (60 mph)', '1,000 km/h (600 mph)'],
    why: 'The fastest run at 320 km/h: nearly three times as fast as a car on the motorway.',
  },
  {
    id: 'queue',
    title: 'Wait in the right place',
    emoji: '🚏',
    q: 'Where do you wait on the platform?',
    right: 'On the marked spot for your carriage',
    wrong: ['Anywhere along the edge', 'At the very front'],
    why: 'Numbers on the platform show where each carriage stops. Queue in a line there, and let people off first.',
  },
  {
    id: 'quick_stops',
    title: 'Be ready to get off',
    emoji: '⏳',
    q: 'How long does the train wait at most stations?',
    right: 'About a minute',
    wrong: ['Ten minutes', 'Until everyone is on'],
    why: 'Often only a minute or so, so have your bags by the door before your stop.',
  },
  {
    id: 'on_time',
    title: 'On time',
    emoji: '🕰️',
    q: 'How punctual are bullet trains?',
    right: 'Usually on time to the minute',
    wrong: ['Often an hour late', "They don't have a timetable"],
    why: "They're famous for it, so be on the platform a few minutes early.",
  },
  {
    id: 'ticket_code',
    title: 'Reading your ticket',
    emoji: '🎫',
    q: 'Your ticket says 7号車 12E. What does it mean?',
    right: 'Carriage 7, row 12, seat E',
    wrong: ['Platform 7, train 12', 'Car park 7, space 12E'],
    why: '号車 (goh-shah) is the carriage, then the row and the seat letter. In ordinary carriages A and E are by the window.',
  },
  {
    id: 'fuji',
    title: 'Seeing Mount Fuji',
    emoji: '🗻',
    q: 'Going from Tokyo to Kyoto, which side is Mount Fuji on?',
    right: 'The right: book seat E',
    wrong: ['The left: book seat A', 'You can never see it'],
    why: "From Tokyo it's out of the right-hand windows, by seat E. Coming back, it's by seat A. Clear winter mornings are best.",
  },
  {
    id: 'gates',
    title: 'Ticket gates',
    emoji: '🚪',
    q: 'You put your ticket in the gate. What happens to it?',
    right: 'It pops out the other side: take it',
    wrong: ['The gate keeps it', 'You show it to a guard'],
    why: 'Take it back as you walk through, because you need it again at the end. With two tickets, put them in together.',
  },
  {
    id: 'eating',
    title: 'Eating on board',
    emoji: '🍱',
    q: 'Can you eat on a bullet train?',
    right: 'Yes: buy an ekiben and enjoy it',
    wrong: ['No, never', 'Only sweets'],
    why: "Station lunch boxes (ekiben) are part of the fun. On busy local trains it's politer to wait.",
  },
  {
    id: 'phone',
    title: 'Quiet carriages',
    emoji: '🤫',
    q: 'Where do you make a phone call?',
    right: 'In the space between carriages',
    wrong: ['In your seat', 'Nowhere at all'],
    why: 'Keep phones on silent in the carriage and step out to the space by the doors to talk.',
  },
  {
    id: 'turn_seats',
    title: 'Sit together',
    emoji: '🔄',
    q: 'Your family wants to sit facing each other. What can you do?',
    right: 'Turn a row of seats round',
    wrong: ['Sit on the floor', 'Ask to swap trains'],
    why: 'A row can be swung round to face the one behind. Check with the people behind first, and turn it back when you get off.',
  },
  {
    id: 'luggage',
    title: 'Big suitcases',
    emoji: '🧳',
    q: 'You have a very big suitcase for the Tokyo to Osaka bullet train. What do you need?',
    right: 'A seat booked with a big-luggage space',
    wrong: ['Nothing special', 'A ticket of its own'],
    why: 'On the Tōkaidō, San\'yō and Kyūshū lines, a case over 160 cm (height + width + depth) needs a seat booked with the space behind the back row. Or send big cases ahead with a luggage delivery service.',
  },
  {
    id: 'rubbish',
    title: 'Take your rubbish',
    emoji: '🗑️',
    q: 'What do you do with your rubbish?',
    right: 'Take it to the bins by the doors',
    wrong: ['Leave it on the seat', 'Hide it in the seat pocket'],
    why: 'Bins are by the doors, and staff often collect rubbish as you get off. Japan has few street bins, so keep a bag for it.',
  },
  {
    id: 'green_car',
    title: 'The Green Car',
    emoji: '🍀',
    q: 'What is the Green Car?',
    right: 'First class, with bigger seats',
    wrong: ['A carriage for plants', 'The carriage for pets'],
    why: 'グリーン車 is first class. Look for the green four-leaf mark.',
  },
  {
    id: 'cleaners',
    title: 'The seven-minute clean',
    emoji: '🧹',
    q: 'At Tokyo, how long do cleaners get to clean a whole bullet train?',
    right: 'About seven minutes',
    wrong: ['An hour', 'All night'],
    why: 'A team cleans the whole train in about seven minutes, turns every seat to face forward, then bows to the waiting passengers.',
  },
  {
    id: 'first',
    title: 'Since 1964',
    emoji: '🎉',
    q: 'When did the first bullet train run?',
    right: '1964',
    wrong: ['1994', '2014'],
    why: 'It opened in 1964, just in time for the Tokyo Olympics.',
  },
];

/** A road sign, drawn. */
export function SignPicture({ sign, size = 96 }: { sign: RoadSign; size?: number }) {
  return (
    <svg className="road-sign-picture" viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={`Sign: ${sign.en}`}>
      {sign.picture}
    </svg>
  );
}

/** A sign as a picture question: what does this one mean? */
export function signQuestion(sign: RoadSign, others: RoadSign[]): Question {
  return {
    id: `sign.${sign.id}`,
    title: sign.en,
    emoji: '🚸',
    q: 'What does this sign mean?',
    right: sign.en,
    wrong: others.filter((o) => o.id !== sign.id).map((o) => o.en),
    why: sign.means,
    picture: <SignPicture sign={sign} />,
  };
}
