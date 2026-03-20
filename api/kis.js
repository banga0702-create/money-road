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

    // 시장 전체 투자자별 매매동향 (KOSPI + KOSDAQ 합산)
    // TR: FHKST01010900 → 종목 투자자별 조회 (지수코드로 시장전체)
    if (action === 'market_investor') {
      const token = await getToken();

      // 코스피 전체 (fid_input_iscd=0001)
      const [rKp, rKq] = await Promise.all([
        fetch(`${BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-member?fid_cond_mrkt_div_code=J&fid_input_iscd=0001`, {
          headers: {
            'content-type': 'application/json',
            'authorization': `Bearer ${token}`,
            'appkey': APP_KEY,
            'appsecret': APP_SECRET,
            'tr_id': 'FHKST01010600',
            'custtype': 'P'
          }
        }),
        fetch(`${BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-member?fid_cond_mrkt_div_code=Q&fid_input_iscd=1001`, {
          headers: {
            'content-type': 'application/json',
            'authorization': `Bearer ${token}`,
            'appkey': APP_KEY,
            'appsecret': APP_SECRET,
            'tr_id': 'FHKST01010600',
            'custtype': 'P'
          }
        })
      ]);
      const kp = await rKp.json();
      const kq = await rKq.json();
      return res.status(200).json({ kospi: kp, kosdaq: kq });
    }

    // 시장 전체 투자자 순매수 (올바른 TR)
    if (action === 'market_trade') {
      const token = await getToken();

      // 전체 시장 투자자별 순매수 현황
      const r = await fetch(
        `${BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-daily-trade-volume?fid_cond_mrkt_div_code=J&fid_input_iscd=0001&fid_period_div_code=D`,
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

    // 업종 현황 (상승/하락 종목수, 거래대금)
    if (action === 'market_updown') {
      const token = await getToken();

      const [rKp, rKq] = await Promise.all([
        fetch(`${BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice?fid_cond_mrkt_div_code=U&fid_input_iscd=0001&fid_input_date_1=&fid_input_date_2=&fid_period_div_code=D`, {
          headers: {
            'content-type': 'application/json',
            'authorization': `Bearer ${token}`,
            'appkey': APP_KEY,
            'appsecret': APP_SECRET,
            'tr_id': 'FHKUP03500100',
            'custtype': 'P'
          }
        }),
        fetch(`${BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice?fid_cond_mrkt_div_code=U&fid_input_iscd=1001&fid_input_date_1=&fid_input_date_2=&fid_period_div_code=D`, {
          headers: {
            'content-type': 'application/json',
            'authorization': `Bearer ${token}`,
            'appkey': APP_KEY,
            'appsecret': APP_SECRET,
            'tr_id': 'FHKUP03500100',
            'custtype': 'P'
          }
        })
      ]);
      const kp = await rKp.json();
      const kq = await rKq.json();
      return res.status(200).json({ kospi: kp, kosdaq: kq });
    }

    return res.status(400).json({ error: 'action 파라미터가 필요해요' });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
