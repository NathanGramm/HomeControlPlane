// Every badge and collectible must name an icon that public/icons.js can draw.
const test = require('node:test');
const assert = require('node:assert');
const { ACHIEVEMENTS, ITEMS } = require('./content');
const { ICONS } = require('../../public/icons');

test('every achievement and item icon exists', () => {
  const missing = [...ACHIEVEMENTS, ...ITEMS].map((x) => x.icon).filter((name) => !ICONS[name]);
  assert.deepStrictEqual(missing, []);
});
