const crypto = require('crypto');
const seenIds = new Set();

function generateId(title, source) {
  return crypto.createHash('md5').update(`${title}-${source}`).digest('hex');
}

function filterNew(articles) {
  return articles.filter(article => {
    if (!seenIds.has(article.id)) {
      seenIds.add(article.id);
      if (seenIds.size > 5000) {
        const first = seenIds.values().next().value;
        seenIds.delete(first);
      }
      return true;
    }
    return false;
  });
}

module.exports = { generateId, filterNew };