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

    // 시장별 투자자매매동향(일별) - 외국인/기관 순매수
    if (action === 'market_investor') {
      const token = await getToken();
      const today = new Date();
      const dateStr = today.getFullYear().toString() +
        String(today.getMonth()+1).padStart(2,'0') +
        String(today.getDate()).padStart(2,'0');

      const [kospiRes, kosdaqRes] = await Promise.all([
        fetch(`${BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-investor-daily-by-market?FID_COND_MRKT_DIV_CODE=U&FID_INPUT_ISCD=0001&FID_INPUT_DATE_1=${dateStr}&FID_INPUT_ISCD_1=KSP&FID_INPUT_DATE_2=${dateStr}&FID_INPUT_ISCD_2=0001`, {
          headers: {
            'content-type': 'application/json',
            'authorization': `Bearer ${token}`,
            'appkey': APP_KEY,
            'appsecret': APP_SECRET,
            'tr_id': 'FHPTJ04040000',
            'custtype': 'P'
          }
        }),
        fetch(`${BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-investor-daily-by-market?FID_COND_MRKT_DIV_CODE=U&FID_INPUT_ISCD=1001&FID_INPUT_DATE_1=${dateStr}&FID_INPUT_ISCD_1=KSQ&FID_INPUT_DATE_2=${dateStr}&FID_INPUT_ISCD_2=1001`, {
          headers: {
            'content-type': 'application/json',
            'authorization': `Bearer ${token}`,
            'appkey': APP_KEY,
            'appsecret': APP_SECRET,
            'tr_id': 'FHPTJ04040000',
            'custtype': 'P'
          }
        })
      ]);

      const kospi  = await kospiRes.json();
      const kosdaq = await kosdaqRes.json();
      return res.status(200).json({ kospi, kosdaq });
    }

    // 국내기관_외국인 매매종목 가집계 - 순매수 상위 종목
    if (action === 'foreign_inst') {
      const token = await getToken();
      const { market = '0000' } = req.query; // 0000:전체, 0001:코스피, 1001:코스닥

      const r = await fetch(
        `${BASE_URL}/uapi/domestic-stock/v1/quotations/foreign-institution-total?FID_COND_MRKT_DIV_CODE=V&FID_COND_SCR_DIV_CODE=16449&FID_INPUT_ISCD=${market}&FID_DIV_CLS_CODE=1&FID_RANK_SORT_CLS_CODE=0&FID_ETC_CLS_CODE=0`,
        {
          headers: {
            'content-type': 'application/json',
            'authorization': `Bearer ${token}`,
            'appkey': APP_KEY,
            'appsecret': APP_SECRET,
            'tr_id': 'FHPTJ04400000',
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
