// Vercel 서버리스 함수 - KIS API 프록시
export default async function handler(req, res) {
  // CORS 설정
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const APP_KEY    = process.env.KIS_APP_KEY;
  const APP_SECRET = process.env.KIS_APP_SECRET;
  const BASE_URL   = 'https://openapi.koreainvestment.com:9443';

  try {
    const { action } = req.query;

    // ── 1. 액세스 토큰 발급
    async function getToken() {
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
      return data.access_token;
    }

    // ── 2. 외국인/기관 순매수 상위 종목
    if (action === 'top_stocks') {
      const token = await getToken();
      const { type = 'F' } = req.query; // F=외국인, I=기관

      const r = await fetch(`${BASE_URL}/uapi/domestic-stock/v1/ranking/investor`, {
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${token}`,
          'appkey': APP_KEY,
          'appsecret': APP_SECRET,
          'tr_id': 'FHPST02060000',
          'custtype': 'P'
        }
      });
      const data = await r.json();
      return res.status(200).json(data);
    }

    // ── 3. 시장 투자자별 매매 현황 (외국인/기관 시장 순매수)
    if (action === 'market_investor') {
      const token = await getToken();
      const { market = 'J' } = req.query; // J=코스피, Q=코스닥

      const r = await fetch(`${BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-investor?fid_cond_mrkt_div_code=${market}&fid_input_iscd=0001`, {
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${token}`,
          'appkey': APP_KEY,
          'appsecret': APP_SECRET,
          'tr_id': 'FHKST01010900',
          'custtype': 'P'
        }
      });
      const data = await r.json();
      return res.status(200).json(data);
    }

    // ── 4. 종목별 외국인/기관 수급
    if (action === 'stock_investor') {
      const token = await getToken();
      const { code } = req.query;

      const r = await fetch(`${BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-investor?fid_cond_mrkt_div_code=J&fid_input_iscd=${code}`, {
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${token}`,
          'appkey': APP_KEY,
          'appsecret': APP_SECRET,
          'tr_id': 'FHKST01010900',
          'custtype': 'P'
        }
      });
      const data = await r.json();
      return res.status(200).json(data);
    }

    // ── 5. 시장 전체 현황 (상승/하락 종목수, 거래대금)
    if (action === 'market_overview') {
      const token = await getToken();

      const r = await fetch(`${BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice?fid_cond_mrkt_div_code=U&fid_input_iscd=0001&fid_input_date_1=&fid_input_date_2=&fid_period_div_code=D&fid_org_adj_prc=1`, {
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${token}`,
          'appkey': APP_KEY,
          'appsecret': APP_SECRET,
          'tr_id': 'FHKST03010100',
          'custtype': 'P'
        }
      });
      const data = await r.json();
      return res.status(200).json(data);
    }

    return res.status(400).json({ error: 'action 파라미터가 필요해요' });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
