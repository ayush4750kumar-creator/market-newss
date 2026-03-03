class Article {
  constructor({ id, title, description, url, imageUrl, source, publishedAt, stock = null }) {
    this.id = id;
    this.title = title;
    this.description = description;
    this.url = url;
    this.imageUrl = imageUrl || null;
    this.source = source;
    this.publishedAt = publishedAt;
    this.stock = stock;
  }
}

class ProcessedNews {
  constructor({ id, headline, story, sentiment, sentimentLabel, stock, imageUrl, source, publishedAt }) {
    this.id = id;
    this.headline = headline;
    this.story = story;
    this.sentiment = sentiment;
    this.sentimentLabel = sentimentLabel;
    this.stock = stock;
    this.imageUrl = imageUrl || null;
    this.source = source;
    this.publishedAt = publishedAt;
    this.createdAt = new Date().toISOString();
  }
}

module.exports = { Article, ProcessedNews };