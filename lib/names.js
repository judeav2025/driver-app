const ADJECTIVES = [
  'Wobbly', 'Turbo', 'Sleepy', 'Grumpy', 'Sneaky', 'Fluffy', 'Spicy', 'Soggy',
  'Zesty', 'Cranky', 'Bouncy', 'Dizzy', 'Jolly', 'Rusty', 'Sparkly', 'Squeaky',
  'Clumsy', 'Fancy', 'Lucky', 'Nervous', 'Salty', 'Speedy', 'Wiggly', 'Chunky',
];

const ANIMALS = [
  'Moose', 'Llama', 'Penguin', 'Otter', 'Badger', 'Walrus', 'Goose', 'Hamster',
  'Raccoon', 'Beaver', 'Yak', 'Narwhal', 'Platypus', 'Ferret', 'Alpaca', 'Sloth',
  'Wombat', 'Lobster', 'Pigeon', 'Capybara', 'Koala', 'Gecko', 'Toucan', 'Panda',
];

// Distinct, readable on a dark road and on a projector.
export const COLORS = [
  '#ff5252', '#ffb300', '#ffee58', '#66bb6a', '#26c6da', '#42a5f5',
  '#ab47bc', '#ec407a', '#ff7043', '#9ccc65', '#8d6e63', '#f5f5f5',
];

const pick = (list, rand) => list[Math.floor(rand() * list.length)];

export function randomName(rand = Math.random) {
  return `${pick(ADJECTIVES, rand)} ${pick(ANIMALS, rand)}`;
}

export function randomColor(rand = Math.random) {
  return pick(COLORS, rand);
}

// A reconnecting phone sends back the name/color it was given so it keeps its identity.
// Anything else gets a fresh random one.
export function cleanName(name) {
  if (typeof name !== 'string') return null;
  const trimmed = name.replace(/[^\p{L}\p{N} '\-]/gu, '').trim().slice(0, 24);
  return trimmed || null;
}

export function cleanColor(color) {
  return COLORS.includes(color) ? color : null;
}
