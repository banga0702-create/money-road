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

    if (action === 'test') {
      const token = await getToken();
      return res.status(200).json({ ok: true, token_length: token.length });
    }

    if (action === 'market_investor') {
      const token = await getToken();
      const today = new Date();
      const dateStr = today.getFullYear().toString() +
        String(today.getMonth()+1).padStart(2,'0') +
        String(today.getDate()).padStart(2,'0');

      const [kospiRes, kosdaqRes] = await Promise.all([
        fetch(`${BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-investor-daily-by-market?FID_COND_MRKT_DIV_CODE=U&FID_INPUT_ISCD=0001&FID_INPUT_DATE_1=${dateStr}&FID_INPUT_ISCD_1=KSP&FID_INPUT_DATE_2=${dateStr}&FID_INPUT_ISCD_2=0001`, {
          headers: { 'content-type': 'application/json', 'authorization': `Bearer ${token}`, 'appkey': APP_KEY, 'appsecret': APP_SECRET, 'tr_id': 'FHPTJ04040000', 'custtype': 'P' }
        }),
        fetch(`${BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-investor-daily-by-market?FID_COND_MRKT_DIV_CODE=U&FID_INPUT_ISCD=1001&FID_INPUT_DATE_1=${dateStr}&FID_INPUT_ISCD_1=KSQ&FID_INPUT_DATE_2=${dateStr}&FID_INPUT_ISCD_2=1001`, {
          headers: { 'content-type': 'application/json', 'authorization': `Bearer ${token}`, 'appkey': APP_KEY, 'appsecret': APP_SECRET, 'tr_id': 'FHPTJ04040000', 'custtype': 'P' }
        })
      ]);

      const kospi  = await kospiRes.json();
      const kosdaq = await kosdaqRes.json();
      return res.status(200).json({ kospi, kosdaq });
    }

    if (action === 'foreign_inst') {
      const token = await getToken();
      const { market = '0000' } = req.query;

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

    // 거래대금 상위 종목 (하락 필터 가능)
    if (action === 'vol_rank') {
      const token = await getToken();
      const { market = '0000' } = req.query;
      // FHPST01710000: 거래량순위 (거래대금 기준 정렬, 하락종목 필터)
      // FID_COND_MKT_DIV_CODE: 0000 전체, 0001 코스피, 1001 코스닥
      // FID_BLNG_CLS_CODE: 0 전체, 1 관리종목제외, 2 투자주의제외, 3 우선주제외, 4 관리/투자주의/우선주제외
      // FID_TRGT_CLS_CODE: 1 하락만
      // FID_TRGT_EXLS_CLS_CODE: 0000 (제외없음)
      // FID_INPUT_PRICE_1/2: 가격범위 (0=제한없음)
      // FID_VOL_CNT: 거래량 하한 (0=제한없음)
      // FID_INPUT_DATE_1: 기준일자
      const r = await fetch(
        `${BASE_URL}/uapi/domestic-stock/v1/quotations/volume-rank?FID_COND_MRKT_DIV_CODE=J&FID_COND_SCR_DIV_CODE=20171&FID_INPUT_ISCD=0001&FID_DIV_CLS_CODE=0&FID_BLNG_CLS_CODE=0&FID_TRGT_CLS_CODE=111111111&FID_TRGT_EXLS_CLS_CODE=0000&FID_INPUT_PRICE_1=0&FID_INPUT_PRICE_2=0&FID_VOL_CNT=0&FID_INPUT_DATE_1=`,
        {
          headers: {
            'content-type': 'application/json',
            'authorization': `Bearer ${token}`,
            'appkey': APP_KEY,
            'appsecret': APP_SECRET,
            'tr_id': 'FHPST01710000',
            'custtype': 'P'
          }
        }
      );
      const data = await r.json();
      return res.status(200).json(data);
    }

    // 코스닥 거래대금 순위 (코스피+코스닥 커버리지 확대용)
    if (action === 'price_rank') {
      const token = await getToken();
      // 코스닥 시장(Q) 거래대금 순위
      const r = await fetch(
        `${BASE_URL}/uapi/domestic-stock/v1/quotations/volume-rank?FID_COND_MRKT_DIV_CODE=J&FID_COND_SCR_DIV_CODE=20171&FID_INPUT_ISCD=1001&FID_DIV_CLS_CODE=0&FID_BLNG_CLS_CODE=0&FID_TRGT_CLS_CODE=111111111&FID_TRGT_EXLS_CLS_CODE=0000&FID_INPUT_PRICE_1=0&FID_INPUT_PRICE_2=0&FID_VOL_CNT=0&FID_INPUT_DATE_1=`,
        {
          headers: {
            'content-type': 'application/json',
            'authorization': `Bearer ${token}`,
            'appkey': APP_KEY,
            'appsecret': APP_SECRET,
            'tr_id': 'FHPST01710000',
            'custtype': 'P'
          }
        }
      );
      const data = await r.json();
      return res.status(200).json(data);
    }

    // 종목코드 목록으로 현재가/등락률/거래대금 일괄 조회
    if (action === 'stock_price') {
      const token = await getToken();
      const { codes } = req.query; // 쉼표로 구분된 종목코드 목록
      if (!codes) return res.status(400).json({ error: 'codes 파라미터 필요' });

      const codeList = codes.split(',').slice(0, 30); // 최대 30개

      const results = await Promise.all(
        codeList.map(code =>
          fetch(`${BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-price?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=${code.trim()}`, {
            headers: {
              'content-type': 'application/json',
              'authorization': `Bearer ${token}`,
              'appkey': APP_KEY,
              'appsecret': APP_SECRET,
              'tr_id': 'FHKST01010100',
              'custtype': 'P'
            }
          }).then(r => r.json()).then(d => ({ code: code.trim(), ...d.output })).catch(() => ({ code: code.trim() }))
        )
      );

      return res.status(200).json({ output: results });
    }

    // 종목별 투자자 일별 매매 현황
    if (action === 'investor') {
      const token = await getToken();
      const { code } = req.query;
      if (!code) return res.status(400).json({ error: 'code 파라미터 필요' });
      const r = await fetch(
        `${BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-investor?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=${code}`,
        { headers: { 'content-type': 'application/json', 'authorization': `Bearer ${token}`, 'appkey': APP_KEY, 'appsecret': APP_SECRET, 'tr_id': 'FHKST01010900', 'custtype': 'P' } }
      );
      const data = await r.json();
      return res.status(200).json(data);
    }

    // 코스피/코스닥 당일 시봉 차트 (ETF 대용)
    // code: 069500=코스피200ETF, 233740=코스닥150ETF
    if (action === 'chart_minute') {
      const token = await getToken();
      const { code = '069500' } = req.query;
      // 3번 호출해서 하루치 분봉 합치기: 11시, 13시, 현재시간
      const now = new Date();
      const hhmm = String(now.getHours()).padStart(2,'0') + String(now.getMinutes()).padStart(2,'0') + '00';
      // 2번 병렬 호출 + output1 포함
      const fetchMin = async (t) => {
        const r = await fetch(
          `${BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice?FID_ETC_CLS_CODE=&FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=${code}&FID_INPUT_HOUR_1=${t}&FID_PW_DATA_INCU_YN=Y`,
          { headers: { 'content-type': 'application/json', 'authorization': `Bearer ${token}`, 'appkey': APP_KEY, 'appsecret': APP_SECRET, 'tr_id': 'FHKST03010200', 'custtype': 'P' } }
        );
        return await r.json();
      };

      // 병렬 호출 (현재가 호출 제거로 타임아웃 방지)
      const [res1, res2] = await Promise.all([fetchMin('110000'), fetchMin(hhmm)]);
      const d1 = res1.output2 || [];
      const d2 = res2.output2 || [];

      // 합치고 시간순 정렬 후 중복 제거
      const seen = new Set();
      const combined = [...d1, ...d2].filter(d => {
        if(seen.has(d.stck_cntg_hour)) return false;
        seen.add(d.stck_cntg_hour);
        return true;
      }).sort((a, b) => a.stck_cntg_hour.localeCompare(b.stck_cntg_hour));

      // output1은 첫번째 호출에서 가져오기
      return res.status(200).json({ output1: res1.output1 || {}, output2: combined });
    }

    // 네이버 모바일 당일 차트 데이터
    if (action === 'naver_chart') {
      const { code = '069500' } = req.query;
      try {
        const r = await fetch(
          `https://m.stock.naver.com/api/stock/${code}/chartdata/day`,
          { headers: {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
            'Referer': 'https://m.stock.naver.com/',
            'Accept': 'application/json'
          }}
        );
        const text = await r.text();
        return res.status(200).send(text);
      } catch(e) {
        return res.status(500).json({ error: e.message });
      }
    }

    return res.status(400).json({ error: 'action 파라미터가 필요해요' });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
