export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const keyword = req.query.q || '주식';
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(keyword)}&hl=ko&gl=KR&ceid=KR:ko`;

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const xml = await response.text();

    // XML 파싱 (정규식으로 item 추출)
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;

    while ((match = itemRegex.exec(xml)) !== null && items.length < 20) {
      const item = match[1];
      const title = (item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || item.match(/<title>(.*?)<\/title>/) || [])[1] || '';
      const link  = (item.match(/<link>(.*?)<\/link>/)  || [])[1] || '';
      const pubDate = (item.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] || '';
      const source = (item.match(/<source[^>]*>(.*?)<\/source>/) || [])[1] || '';

      if (title && link) {
        items.push({
          title: title.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#39;/g,"'").replace(/&quot;/g,'"'),
          link,
          pubDate,
          source: source.replace(/&amp;/g,'&')
        });
      }
    }

    res.setHeader('Cache-Control', 's-maxage=300'); // 5분 캐시
    return res.status(200).json({ keyword, items });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
