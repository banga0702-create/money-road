export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const keyword = req.query.q || '주식';
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(keyword)}&hl=ko&gl=KR&ceid=KR:ko`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*'
      }
    });

    const text = await response.text();

    // XML이 아닌 응답이면 빈 배열 반환 (에러 페이지 등)
    if (!text.includes('<rss') && !text.includes('<feed')) {
      console.error('구글 뉴스 비정상 응답:', text.slice(0, 200));
      return res.status(200).json({ keyword, items: [], error: 'not_xml' });
    }

    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;

    while ((match = itemRegex.exec(text)) !== null && items.length < 20) {
      const block = match[1];

      const titleMatch = block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) ||
                         block.match(/<title>([\s\S]*?)<\/title>/);
      const linkMatch  = block.match(/<link>([\s\S]*?)<\/link>/) ||
                         block.match(/<link[^>]*href="([^"]+)"/);
      const pubMatch   = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
      const srcMatch   = block.match(/<source[^>]*>([\s\S]*?)<\/source>/);

      const title = (titleMatch?.[1] || '').trim();
      const link  = (linkMatch?.[1] || '').trim();
      const pubDate = (pubMatch?.[1] || '').trim();
      const source = (srcMatch?.[1] || '').trim();

      if (title && link) {
        items.push({
          title: title
            .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
            .replace(/&#39;/g,"'").replace(/&quot;/g,'"'),
          link,
          pubDate,
          source: source.replace(/&amp;/g,'&')
        });
      }
    }

    res.setHeader('Cache-Control', 's-maxage=300');
    return res.status(200).json({ keyword, items });

  } catch (e) {
    console.error('news.js error:', e.message);
    return res.status(200).json({ keyword, items: [], error: e.message });
  }
}
