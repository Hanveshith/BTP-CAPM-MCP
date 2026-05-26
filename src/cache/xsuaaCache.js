const cache = new Map();

function get(appGuid) {
  return cache.get(appGuid);
}

function set(appGuid, value) {
  cache.set(appGuid, value);
}

function has(appGuid) {
  return cache.has(appGuid);
}

module.exports = {
  get,
  set,
  has
};