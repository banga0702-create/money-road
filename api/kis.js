// Vercel 서버리스 함수 - KIS API 프록시
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

    // 토큰 캐싱 (20분)
    async function getToken() {
      const now = Date.now();
      if (_token && now < _tokenExp) return _token;
      const r = await fetch(`${BASE_URL}/oauth2/tokenP`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grant_type: 'client_credentials', appkey: APP_KEY, appsecret: APP_SECRET })
      });
      const data = await r.json();
      if (!data.access_token) throw new Error('토큰 발급 실패: ' + JSON.stringify(data));
      _token = data.access_token;
      _tokenExp = now + 20 * 60 * 1000;
      return _token;
    }

    // 토큰 테스트
    if (action === 'test') {
      const token = await getToken();
      return res.status(200).json({ ok: true, token_length: token.length });
    }

    // 시장별 투자자매매동향 (시세) - 외국인/기관 실시간 순매수
    // TR: FHKST01010900 → 국내기관_외국인 매매종목가집계
    if (action === 'market_investor') {
      const token = await getToken();
      const { market = 'J' } = req.query; // J=코스피, Q=코스닥

      const r = await fetch(
        `${BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-daily-trade-volume?fid_cond_mrkt_div_code=${market}&fid_input_iscd=0001&fid_period_div_code=D`,
        {
          headers: {
            'content-type': 'application/json',
            'authorization': `Bearer ${token}`,
            'appkey': APP_KEY,
            'appsecret': APP_SECRET,
            'tr_id': 'FHKST01010400',
            'custtype': 'P'
          }
        }
      );
      const data = await r.json();
      return res.status(200).json(data);
    }

    // 시장별 투자자매매동향 (일별) - 가장 정확한 TR
    if (action === 'market_daily') {
      const token = await getToken();
      const { market = 'J' } = req.query;

      const r = await fetch(
        `${BASE_URL}/uapi/domestic-stock/v1/quotations/investor-trend-estimate?fid_cond_mrkt_div_code=${market}`,
        {
          headers: {
            'content-type': 'application/json',
            'authorization': `Bearer ${token}`,
            'appkey': APP_KEY,
            'appsecret': APP_SECRET,
            'tr_id': 'FHKST01010800',
            'custtype': 'P'
          }
        }
      );
      const data = await r.json();
      return res.status(200).json(data);
    }

    // 국내기관_외국인 매매종목 가집계 (실시간 추정)
    if (action === 'foreign_inst') {
      const token = await getToken();

      const r = await fetch(
        `${BASE_URL}/uapi/domestic-stock/v1/quotations/foreign-institution-total?fid_cond_mrkt_div_code=J&fid_input_iscd=0000&fid_div_cls_code=0&fid_rank_sort_cls_code=0&fid_etc_cls_code=0`,
        {
          headers: {
            'content-type': 'application/json',
            'authorization': `Bearer ${token}`,
            'appkey': APP_KEY,
            'appsecret': APP_SECRET,
            'tr_id': 'FHPST02060000',
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
