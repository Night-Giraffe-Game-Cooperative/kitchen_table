// Holiday phrases for a family learning a language together: what to say,
// how to say it (spelled the way it sounds to English ears), and how hard it
// is. Level 1 is for ages 5 to 7, level 2 adds more for 8 to 10, and level 3
// is everything. Keys are saved on the server, so never rename an id.

export type Lang = 'ja' | 'fr';
export type Level = 1 | 2 | 3;

export interface Phrase {
  id: string;
  /** What it means. */
  en: string;
  /** Written the way they write it: kana with spaces between words for Japanese. */
  text: string;
  /** Japanese in our letters (romaji). */
  roman?: string;
  /** How to say it, spelled for English speakers. */
  say: string;
  level: Level;
  /** A short tip, like when to say it. */
  note?: string;
  /** What the voice reads, when it differs from the text. */
  speak?: string;
  /** Signs only: seen at the station rather than around town. */
  where?: 'station';
}

export interface Topic {
  id: string;
  title: string;
  emoji: string;
  phrases: Phrase[];
}

export interface Language {
  id: Lang;
  name: string;
  flag: string;
  /** For the voice and the lang attribute. */
  bcp47: string;
  topics: Topic[];
  signs: Phrase[];
}

const p = (id: string, en: string, text: string, say: string, level: Level, more: Partial<Phrase> = {}): Phrase => ({ id, en, text, say, level, ...more });

const japanese: Language = {
  id: 'ja',
  name: 'Japanese',
  flag: '🇯🇵',
  bcp47: 'ja-JP',
  topics: [
    {
      id: 'hello',
      title: 'Hello and goodbye',
      emoji: '👋',
      phrases: [
        p('hello', 'Hello', 'こんにちは', 'kon-nee-chee-wah', 1, { roman: 'konnichiwa' }),
        p('good_morning', 'Good morning', 'おはよう ございます', 'oh-hah-yoh go-zai-mass', 2, { roman: 'ohayō gozaimasu' }),
        p('good_evening', 'Good evening', 'こんばんは', 'kon-ban-wah', 2, { roman: 'konbanwa' }),
        p('goodbye', 'Goodbye', 'さようなら', 'sah-yoh-nah-rah', 1, { roman: 'sayōnara' }),
        p('good_night', 'Good night', 'おやすみなさい', 'oh-yah-soo-mee-nah-sigh', 1, { roman: 'oyasuminasai' }),
        p('nice_to_meet', 'Nice to meet you', 'はじめまして', 'hah-jee-meh-mash-teh', 2, { roman: 'hajimemashite' }),
        p('yes', 'Yes', 'はい', 'high', 1, { roman: 'hai' }),
        p('no', 'No', 'いいえ', 'ee-eh', 1, { roman: 'iie' }),
      ],
    },
    {
      id: 'manners',
      title: 'Please and thank you',
      emoji: '🙏',
      phrases: [
        p('thank_you', 'Thank you', 'ありがとう', 'ah-ree-gah-toh', 1, { roman: 'arigatō' }),
        p('thank_you_very', 'Thank you very much', 'ありがとう ございます', 'ah-ree-gah-toh go-zai-mass', 2, { roman: 'arigatō gozaimasu' }),
        p('please', 'Please', 'おねがい します', 'oh-neh-guy shee-mass', 2, { roman: 'onegai shimasu', note: 'When you ask for something.' }),
        p('excuse_me', 'Excuse me', 'すみません', 'soo-mee-mah-sen', 1, { roman: 'sumimasen', note: 'Also a polite sorry, and how to call a waiter.' }),
        p('sorry', 'Sorry', 'ごめんなさい', 'go-men nah-sigh', 1, { roman: 'gomen nasai' }),
        p('welcome', "You're welcome", 'どういたしまして', 'doh ee-tash-ee-mash-teh', 3, { roman: 'dō itashimashite' }),
      ],
    },
    {
      id: 'food',
      title: 'Eating out',
      emoji: '🍜',
      phrases: [
        p('lets_eat', 'Before you eat', 'いただきます', 'ee-tah-dah-kee-mass', 1, { roman: 'itadakimasu', note: 'Everyone says it together before a meal.' }),
        p('after_meal', 'After you eat', 'ごちそうさまでした', 'go-chee-soh-sah-mah desh-tah', 2, { roman: 'gochisōsama deshita', note: 'Thanks for the meal, said when you finish.' }),
        p('delicious', 'Delicious!', 'おいしい', 'oy-shee', 1, { roman: 'oishii' }),
        p('this_please', 'This one, please', 'これを ください', 'koh-reh oh koo-dah-sigh', 1, { roman: 'kore o kudasai', note: 'Point at the menu or the picture.' }),
        p('water', 'Water, please', 'おみずを ください', 'oh-mee-zoo oh koo-dah-sigh', 2, { roman: 'omizu o kudasai' }),
        p('four_of_us', 'There are four of us', 'よにんです', 'yoh-neen dess', 3, { roman: 'yonin desu', note: 'When you ask for a table.' }),
        p('bill', 'The bill, please', 'おかいけい おねがい します', 'oh-kai-kay oh-neh-guy shee-mass', 3, { roman: 'okaikei onegai shimasu' }),
        p('no_nuts', "I can't eat nuts", 'ナッツが たべられません', 'nat-tsoo gah tah-beh-rah-reh-mah-sen', 3, { roman: 'nattsu ga taberaremasen' }),
      ],
    },
    {
      id: 'around',
      title: 'Getting around',
      emoji: '🧭',
      phrases: [
        p('toilet', 'Where is the toilet?', 'トイレは どこですか', 'toy-reh wah doh-koh dess-kah', 1, { roman: 'toire wa doko desu ka' }),
        p('station', 'Where is the station?', 'えきは どこですか', 'eh-kee wah doh-koh dess-kah', 2, { roman: 'eki wa doko desu ka' }),
        p('left', 'Left', 'ひだり', 'hee-dah-ree', 2, { roman: 'hidari' }),
        p('right', 'Right', 'みぎ', 'mee-gee', 2, { roman: 'migi' }),
        p('straight_on', 'Straight on', 'まっすぐ', 'mass-soo-goo', 3, { roman: 'massugu' }),
        p('dont_understand', "I don't understand", 'わかりません', 'wah-kah-ree-mah-sen', 2, { roman: 'wakarimasen' }),
        p('english', 'Do you speak English?', 'えいごを はなせますか', 'ay-go oh hah-nah-seh-mass-kah', 2, { roman: 'eigo o hanasemasu ka' }),
        p('again', 'Once more, please', 'もう いちど おねがい します', 'moh ee-chee-doh oh-neh-guy shee-mass', 3, { roman: 'mō ichido onegai shimasu' }),
      ],
    },
    {
      id: 'trains',
      title: 'Bullet trains',
      emoji: '🚄',
      phrases: [
        p('shinkansen', 'Bullet train', 'しんかんせん', 'shin-kan-sen', 1, { roman: 'shinkansen' }),
        p('ekiben', 'Station lunch box', 'えきべん', 'eh-kee-ben', 1, { roman: 'ekiben', note: 'A bento from the station, to eat on the train.' }),
        p('fuji', 'Mount Fuji!', 'ふじさん', 'foo-jee-san', 1, { roman: 'Fuji-san', note: 'Going from Tokyo to Kyoto, look out of the right-hand windows.' }),
        p('window_seat', 'Window seat', 'まどがわ', 'mah-doh-gah-wah', 2, { roman: 'madogawa' }),
        p('which_platform', 'Which platform?', 'なんばんせん ですか', 'nan-ban-sen dess-kah', 2, { roman: 'nanbansen desu ka' }),
        p('change_trains', 'Change trains', 'のりかえ', 'noh-ree-kah-eh', 2, { roman: 'norikae' }),
        p('reserved', 'Reserved seat', 'していせき', 'shee-tay-seh-kee', 3, { roman: 'shitei-seki' }),
        p('unreserved', 'Unreserved seat', 'じゆうせき', 'jee-yoo-seh-kee', 3, { roman: 'jiyū-seki', note: 'Sit in any free seat in these carriages.' }),
        p('aisle_seat', 'Aisle seat', 'つうろがわ', 'tsoo-roh-gah-wah', 3, { roman: 'tsūrogawa' }),
        p('ticket_to', 'One ticket to Kyoto, please', 'きょうとまで いちまい ください', 'kyoh-toh mah-deh ee-chee-my koo-dah-sigh', 3, {
          roman: 'Kyōto made ichimai kudasai',
          note: 'Say where you are going. Two tickets is にまい (nee-my).',
        }),
        p('train_for', 'Is this the train for Osaka?', 'これは おおさか いき ですか', 'koh-reh wah oh-sah-kah ee-kee dess-kah', 3, { roman: 'kore wa Ōsaka iki desu ka' }),
        p('seat_free', 'Is this seat free?', 'この せき、 あいて いますか', 'koh-noh seh-kee, eye-teh ee-mass-kah', 3, { roman: 'kono seki, aite imasu ka' }),
        p('my_seat', "Excuse me, it's my seat", 'すみません、 わたしの せき です', 'soo-mee-mah-sen, wah-tah-shee noh seh-kee dess', 3, {
          roman: 'sumimasen, watashi no seki desu',
          note: 'Show your ticket with a smile.',
        }),
      ],
    },
    {
      id: 'shopping',
      title: 'Shopping',
      emoji: '🛍️',
      phrases: [
        p('cute', "It's cute!", 'かわいい', 'kah-wah-ee', 1, { roman: 'kawaii' }),
        p('how_much', 'How much is it?', 'いくらですか', 'ee-koo-rah dess-kah', 2, { roman: 'ikura desu ka' }),
        p('just_looking', "I'm just looking", 'みている だけです', 'mee-teh ee-roo dah-keh dess', 3, { roman: 'mite iru dake desu' }),
        p('card', 'Can I pay by card?', 'カードで はらえますか', 'kah-doh deh hah-rah-eh-mass-kah', 3, { roman: 'kādo de haraemasu ka' }),
      ],
    },
    {
      id: 'help',
      title: 'If you need help',
      emoji: '🆘',
      phrases: [
        p('help', 'Help!', 'たすけて', 'tass-keh-teh', 1, { roman: 'tasukete' }),
        p('lost', "I'm lost", 'まいごです', 'my-go dess', 1, { roman: 'maigo desu', note: 'Said by a child who has lost their grown-ups.' }),
        p('hurts', 'It hurts', 'いたい', 'ee-tie', 1, { roman: 'itai' }),
        p('police', 'Please call the police', 'けいさつを よんで ください', 'kay-sat-soo oh yon-deh koo-dah-sigh', 3, { roman: 'keisatsu o yonde kudasai' }),
        p('doctor', 'Please call a doctor', 'いしゃを よんで ください', 'ee-shah oh yon-deh koo-dah-sigh', 3, { roman: 'isha o yonde kudasai' }),
      ],
    },
    {
      id: 'numbers',
      title: 'Numbers',
      emoji: '🔢',
      phrases: [
        p('n1', 'One', 'いち', 'ee-chee', 1, { roman: 'ichi' }),
        p('n2', 'Two', 'に', 'nee', 1, { roman: 'ni' }),
        p('n3', 'Three', 'さん', 'san', 1, { roman: 'san' }),
        p('n4', 'Four', 'よん', 'yon', 1, { roman: 'yon' }),
        p('n5', 'Five', 'ご', 'go', 1, { roman: 'go' }),
        p('n6', 'Six', 'ろく', 'roh-koo', 2, { roman: 'roku' }),
        p('n7', 'Seven', 'なな', 'nah-nah', 2, { roman: 'nana' }),
        p('n8', 'Eight', 'はち', 'hah-chee', 2, { roman: 'hachi' }),
        p('n9', 'Nine', 'きゅう', 'kyoo', 2, { roman: 'kyū' }),
        p('n10', 'Ten', 'じゅう', 'joo', 2, { roman: 'jū' }),
      ],
    },
  ],
  signs: [
    p('sign.toilet', 'Toilet', 'トイレ', 'toy-reh', 1, { roman: 'toire' }),
    p('sign.water', 'Water', '水', 'mee-zoo', 1, { roman: 'mizu', speak: 'みず' }),
    p('sign.men', 'Men', '男', 'oh-toh-koh', 1, { roman: 'otoko', speak: 'おとこ' }),
    p('sign.women', 'Women', '女', 'on-nah', 1, { roman: 'onna', speak: 'おんな' }),
    p('sign.entrance', 'Way in', '入口', 'ee-ree-goo-chee', 2, { roman: 'iriguchi', speak: 'いりぐち' }),
    p('sign.exit', 'Way out', '出口', 'deh-goo-chee', 2, { roman: 'deguchi', speak: 'でぐち' }),
    p('sign.station', 'Station', '駅', 'eh-kee', 2, { roman: 'eki', speak: 'えき' }),
    p('sign.yen', 'Yen (money)', '円', 'en', 2, { roman: 'en', speak: 'えん' }),
    p('sign.push', 'Push (on a door)', '押', 'oh-soo', 2, { roman: 'osu', speak: 'おす' }),
    p('sign.pull', 'Pull (on a door)', '引', 'hee-koo', 2, { roman: 'hiku', speak: 'ひく' }),
    p('sign.danger', 'Danger', '危険', 'kee-ken', 3, { roman: 'kiken', speak: 'きけん' }),
    p('sign.no_smoking', 'No smoking', '禁煙', 'keen-en', 3, { roman: "kin'en", speak: 'きんえん' }),
    p('sign.open', 'Open', '営業中', 'ay-gyoh-choo', 3, { roman: 'eigyōchū', speak: 'えいぎょうちゅう' }),
    p('sign.shinkansen', 'Bullet train', '新幹線', 'shin-kan-sen', 1, { roman: 'shinkansen', speak: 'しんかんせん', where: 'station' }),
    p('sign.ticket_gate', 'Ticket gates', '改札', 'kai-sat-soo', 2, { roman: 'kaisatsu', speak: 'かいさつ', where: 'station' }),
    p('sign.tickets', 'Tickets', 'きっぷ', 'kip-poo', 2, { roman: 'kippu', where: 'station', note: 'Ticket machines and ticket offices say きっぷ or 切符.' }),
    p('sign.platform', 'Platform (14番線 is platform 14)', '番線', 'ban-sen', 2, { roman: 'bansen', speak: 'ばんせん', where: 'station' }),
    p('sign.car', 'Carriage (7号車 is carriage 7)', '号車', 'goh-shah', 2, {
      roman: 'gōsha',
      speak: 'ごうしゃ',
      where: 'station',
      note: 'Painted on the platform where that carriage stops.',
    }),
    p('sign.change', 'Change here for', '乗換', 'noh-ree-kah-eh', 3, { roman: 'norikae', speak: 'のりかえ', where: 'station' }),
    p('sign.unreserved', 'Unreserved carriages', '自由席', 'jee-yoo-seh-kee', 3, { roman: 'jiyū-seki', speak: 'じゆうせき', where: 'station' }),
    p('sign.reserved', 'Reserved carriages', '指定席', 'shee-tay-seh-kee', 3, { roman: 'shitei-seki', speak: 'していせき', where: 'station' }),
    p('sign.green_car', 'Green Car (first class)', 'グリーン車', 'goo-reen-shah', 3, { roman: 'gurīn-sha', speak: 'グリーンしゃ', where: 'station' }),
  ],
};

const french: Language = {
  id: 'fr',
  name: 'French',
  flag: '🇫🇷',
  bcp47: 'fr-FR',
  topics: [
    {
      id: 'hello',
      title: 'Hello and goodbye',
      emoji: '👋',
      phrases: [
        p('hello', 'Hello', 'Bonjour', 'bon-zhoor', 1, { note: 'Say it to everyone, even in shops.' }),
        p('good_evening', 'Good evening', 'Bonsoir', 'bon-swah', 2),
        p('hi', 'Hi, or bye (to friends)', 'Salut', 'sah-loo', 2),
        p('goodbye', 'Goodbye', 'Au revoir', 'oh ruh-vwah', 1),
        p('good_night', 'Good night', 'Bonne nuit', 'bon nwee', 1),
        p('nice_to_meet', 'Nice to meet you', 'Enchanté', 'on-shon-tay', 2),
        p('yes', 'Yes', 'Oui', 'wee', 1),
        p('no', 'No', 'Non', 'non', 1),
        p('how_are_you', 'How are you?', 'Comment ça va ?', 'kom-on sah vah', 2),
        p('fine_thanks', "I'm fine, thanks", 'Ça va bien, merci', 'sah vah byan, mair-see', 2),
      ],
    },
    {
      id: 'manners',
      title: 'Please and thank you',
      emoji: '🙏',
      phrases: [
        p('please', 'Please', "S'il vous plaît", 'seel voo pleh', 1),
        p('thank_you', 'Thank you', 'Merci', 'mair-see', 1),
        p('thank_you_very', 'Thank you very much', 'Merci beaucoup', 'mair-see boh-koo', 1),
        p('welcome', "You're welcome", 'De rien', 'duh ree-an', 2),
        p('excuse_me', 'Excuse me', 'Excusez-moi', 'ex-kew-zay mwah', 2),
        p('sorry', 'Sorry', 'Pardon', 'par-don', 1),
      ],
    },
    {
      id: 'food',
      title: 'Eating out',
      emoji: '🥐',
      phrases: [
        p('enjoy', 'Enjoy your meal', 'Bon appétit !', 'bon ah-pay-tee', 1),
        p('delicious', "It's delicious!", "C'est délicieux !", 'say day-lee-syuh', 1),
        p('ice_cream', 'An ice cream, please', "Une glace, s'il vous plaît", 'oon glass, seel voo pleh', 1),
        p('croissant', "I'd like a croissant, please", "Je voudrais un croissant, s'il vous plaît", 'zhuh voo-dreh uhn krwah-son, seel voo pleh', 2),
        p('water', 'Some water, please', "De l'eau, s'il vous plaît", 'duh loh, seel voo pleh', 2),
        p('table_four', 'A table for four, please', "Une table pour quatre, s'il vous plaît", 'oon tahbl poor katr, seel voo pleh', 3),
        p('bill', 'The bill, please', "L'addition, s'il vous plaît", 'lah-dee-syon, seel voo pleh', 2),
        p('no_nuts', "I'm allergic to nuts", 'Je suis allergique aux noix', 'zhuh swee ah-lair-zheek oh nwah', 3),
      ],
    },
    {
      id: 'around',
      title: 'Getting around',
      emoji: '🚆',
      phrases: [
        p('toilet', 'Where are the toilets?', 'Où sont les toilettes ?', 'oo son lay twah-let', 1),
        p('station', 'Where is the station?', 'Où est la gare ?', 'oo ay lah gar', 2),
        p('left', 'On the left', 'À gauche', 'ah gohsh', 2),
        p('right', 'On the right', 'À droite', 'ah drwat', 2),
        p('straight_on', 'Straight on', 'Tout droit', 'too drwah', 3),
        p('dont_understand', "I don't understand", 'Je ne comprends pas', 'zhuh nuh kom-pron pah', 2),
        p('english', 'Do you speak English?', 'Parlez-vous anglais ?', 'par-lay voo on-gleh', 2),
        p('again', 'Can you say that again, please?', "Vous pouvez répéter, s'il vous plaît ?", 'voo poo-vay ray-pay-tay, seel voo pleh', 3),
      ],
    },
    {
      id: 'shopping',
      title: 'Shopping',
      emoji: '🛍️',
      phrases: [
        p('pretty', "It's pretty!", "C'est joli !", 'say zho-lee', 1),
        p('how_much', 'How much is it?', "C'est combien ?", 'say kom-byan', 2),
        p('just_looking', "I'm just looking, thanks", 'Je regarde, merci', 'zhuh ruh-gard, mair-see', 3),
        p('card', 'Can I pay by card?', 'Je peux payer par carte ?', 'zhuh puh pay-yay par kart', 3),
      ],
    },
    {
      id: 'help',
      title: 'If you need help',
      emoji: '🆘',
      phrases: [
        p('help', 'Help!', 'Au secours !', 'oh suh-koor', 1),
        p('lost', "I'm lost", 'Je suis perdu', 'zhuh swee pair-dew', 1, { note: 'A girl writes perdue. It sounds the same.' }),
        p('hurts', 'It hurts here', "J'ai mal ici", 'zhay mal ee-see', 2),
        p('police', 'Call the police!', 'Appelez la police !', 'ah-play lah po-leess', 3),
        p('doctor', 'Call a doctor!', 'Appelez un médecin !', 'ah-play uhn mayd-san', 3),
      ],
    },
    {
      id: 'numbers',
      title: 'Numbers',
      emoji: '🔢',
      phrases: [
        p('n1', 'One', 'un', 'uhn', 1),
        p('n2', 'Two', 'deux', 'duh', 1),
        p('n3', 'Three', 'trois', 'trwah', 1),
        p('n4', 'Four', 'quatre', 'katr', 1),
        p('n5', 'Five', 'cinq', 'sank', 1),
        p('n6', 'Six', 'six', 'seess', 2),
        p('n7', 'Seven', 'sept', 'set', 2),
        p('n8', 'Eight', 'huit', 'weet', 2),
        p('n9', 'Nine', 'neuf', 'nuhf', 2),
        p('n10', 'Ten', 'dix', 'deess', 2),
      ],
    },
  ],
  signs: [
    p('sign.toilet', 'Toilets', 'Toilettes', 'twah-let', 1),
    p('sign.open', 'Open', 'Ouvert', 'oo-vair', 1),
    p('sign.closed', 'Closed', 'Fermé', 'fair-may', 1),
    p('sign.bakery', 'Bakery', 'Boulangerie', 'boo-lon-zhuh-ree', 1),
    p('sign.ice_cream', 'Ice creams', 'Glaces', 'glass', 1),
    p('sign.entrance', 'Way in', 'Entrée', 'on-tray', 2),
    p('sign.exit', 'Way out', 'Sortie', 'sor-tee', 2),
    p('sign.station', 'Station', 'Gare', 'gar', 2),
    p('sign.men', 'Men', 'Hommes', 'om', 2),
    p('sign.women', 'Women', 'Femmes', 'fam', 2),
    p('sign.push', 'Push', 'Poussez', 'poo-say', 2),
    p('sign.pull', 'Pull', 'Tirez', 'tee-ray', 2),
    p('sign.chemist', 'Chemist', 'Pharmacie', 'far-mah-see', 3),
    p('sign.careful', 'Careful!', 'Attention', 'ah-ton-syon', 3),
    p('sign.no_smoking', 'No smoking', 'Défense de fumer', 'day-fonce duh few-may', 3),
  ],
};

export const languages: Language[] = [japanese, french];

export const languageOf = (id: Lang) => languages.find((l) => l.id === id)!;

/** The key saved on the server for a phrase, sign or character. */
export const keyOf = (lang: Lang, id: string) => `${lang}.${id}`;

/** Every phrase in a language, topic by topic. */
export const allPhrases = (lang: Language) => lang.topics.flatMap((t) => t.phrases);

// Kana, row by row as Japanese children learn them, with gaps where a row has
// fewer than five.
const rows: (string | null)[][] = [
  ['a', 'i', 'u', 'e', 'o'],
  ['ka', 'ki', 'ku', 'ke', 'ko'],
  ['sa', 'shi', 'su', 'se', 'so'],
  ['ta', 'chi', 'tsu', 'te', 'to'],
  ['na', 'ni', 'nu', 'ne', 'no'],
  ['ha', 'hi', 'fu', 'he', 'ho'],
  ['ma', 'mi', 'mu', 'me', 'mo'],
  ['ya', null, 'yu', null, 'yo'],
  ['ra', 'ri', 'ru', 're', 'ro'],
  ['wa', null, null, null, 'wo'],
  ['n', null, null, null, null],
];

const hiragana = 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん';
const katakana = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン';

export type Script = 'hira' | 'kata';

export interface Kana {
  char: string;
  roman: string;
  /** Saved as ja.hira.ka or ja.kata.ka. */
  id: string;
  /** Which row it's in, from 0 (a i u e o) to 10 (n). */
  row: number;
}

/** A script's characters as rows of five, with null for the gaps. */
export function kanaRows(script: Script): (Kana | null)[][] {
  const chars = [...(script === 'hira' ? hiragana : katakana)];
  let i = 0;
  return rows.map((row, r) => row.map((roman) => (roman ? { char: chars[i++], roman, id: `${script}.${roman}`, row: r } : null)));
}

export const kanaList = (script: Script): Kana[] => kanaRows(script).flat().filter((k): k is Kana => !!k);

export const scriptName: Record<Script, string> = { hira: 'Hiragana', kata: 'Katakana' };
