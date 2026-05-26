const cache = new Map();

function get(key) {
  return cache.get(key);
}

function set(key, value) {
  cache.set(key, value);
}

function has(key) {
  return cache.has(key);
}

function remove(key) {
  cache.delete(key);
}

module.exports = {
  get,
  set,
  has,
  remove
};