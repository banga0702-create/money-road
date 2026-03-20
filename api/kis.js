// Vercel 서버리스 함수 - KIS API 프록시
// 토큰 캐시 (서버리스 인스턴스 내 메모리 캐시)
let _token = null;
let _tokenExp = 0;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const APP_KEY    = process.env.KIS_APP_KEY;
  const APP_SECRET = process.env.KIS_APP_SECRET;
  const BASE_URL   = 'https://openapi.koreainvestment.com:9443';

  try {
    const { action } = req.query;

    // 액세스 토큰 발급 (캐시 적용 - 20분 유효)
    async function getToken() {
      const now = Date.now();
      if (_token && now < _tokenExp) return _token;

      const r = await fetch(`${BASE_URL}/oauth2/tokenP`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          appkey: APP_KEY,
          appsecret: APP_SECRET
        })
      });
      const data = await r.json();
      if (!data.access_token) throw new Error('토큰 발급 실패: ' + JSON.stringify(data));
      _token = data.access_token;
      _tokenExp = now + 20 * 60 * 1000; // 20분 캐시
      return _token;
    }

    // 토큰 테스트
    if (action === 'test') {
      const token = await getToken();
      return res.status(200).json({ ok: true, token_length: token.length });
    }

    // 시장 투자자별 매매동향 (외국인/기관 순매수)
    if (action === 'market_investor') {
      const token = await getToken();
      const { market = 'J' } = req.query;
      const iscd = market === 'J' ? '0001' : '1001';

      const r = await fetch(
        `${BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-investor?fid_cond_mrkt_div_code=${market}&fid_input_iscd=${iscd}`,
        {
          headers: {
            'content-type': 'application/json',
            'authorization': `Bearer ${token}`,
            'appkey': APP_KEY,
            'appsecret': APP_SECRET,
            'tr_id': 'FHKST01010900',
            'custtype': 'P'
          }
        }
      );
      const data = await r.json();
      return res.status(200).json(data);
    }

    return res.status(400).json({ error: 'action 파라미터가 필요해요' });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
