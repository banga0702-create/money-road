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
      // 토큰 만료 or 없으면 새로 발급 (최대 2회 재시도)
      for(let attempt = 0; attempt < 2; attempt++) {
        try {
          const r = await fetch(`${BASE_URL}/oauth2/tokenP`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ grant_type: 'client_credentials', appkey: APP_KEY, appsecret: APP_SECRET })
          });
          const data = await r.json();
          if(data.error_code === 'EGW00133') {
            // 1분당 1회 제한 - 잠시 대기 후 재시도
            await new Promise(resolve => setTimeout(resolve, 2000));
            continue;
          }
          if (!data.access_token) throw new Error('토큰 발급 실패: ' + JSON.stringify(data));
          _token = data.access_token;
          _tokenExp = now + 23 * 60 * 1000; // 23분 캐시
          return _token;
        } catch(e) {
          if(attempt === 1) throw e;
        }
      }
      throw new Error('토큰 발급 실패');
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

      // 순차 호출 (병렬 시 토큰 제한 오류 방지)
      const kospiRes = await fetch(`${BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-investor-daily-by-market?FID_COND_MRKT_DIV_CODE=U&FID_INPUT_ISCD=0001&FID_INPUT_DATE_1=${dateStr}&FID_INPUT_ISCD_1=KSP&FID_INPUT_DATE_2=${dateStr}&FID_INPUT_ISCD_2=0001`, {
        headers: { 'content-type': 'application/json', 'authorization': `Bearer ${token}`, 'appkey': APP_KEY, 'appsecret': APP_SECRET, 'tr_id': 'FHPTJ04040000', 'custtype': 'P' }
      });
      const kospi = await kospiRes.json();

      const kosdaqRes = await fetch(`${BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-investor-daily-by-market?FID_COND_MRKT_DIV_CODE=U&FID_INPUT_ISCD=1001&FID_INPUT_DATE_1=${dateStr}&FID_INPUT_ISCD_1=KSQ&FID_INPUT_DATE_2=${dateStr}&FID_INPUT_ISCD_2=1001`, {
        headers: { 'content-type': 'application/json', 'authorization': `Bearer ${token}`, 'appkey': APP_KEY, 'appsecret': APP_SECRET, 'tr_id': 'FHPTJ04040000', 'custtype': 'P' }
      });
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

    // 외국인TOP30 + 기관TOP30 합산 (커버리지 확대)
    if (action === 'foreign_inst_combined') {
      const token = await getToken();
      const { market = '0000' } = req.query;

      // 외국인 TOP30
      const fRes = await fetch(
        `${BASE_URL}/uapi/domestic-stock/v1/quotations/foreign-institution-total?FID_COND_MRKT_DIV_CODE=V&FID_COND_SCR_DIV_CODE=16449&FID_INPUT_ISCD=${market}&FID_DIV_CLS_CODE=1&FID_RANK_SORT_CLS_CODE=0&FID_ETC_CLS_CODE=0`,
        { headers: { 'content-type': 'application/json', 'authorization': `Bearer ${token}`, 'appkey': APP_KEY, 'appsecret': APP_SECRET, 'tr_id': 'FHPTJ04400000', 'custtype': 'P' } }
      );
      const fData = await fRes.json();

      // 기관 TOP30 (순차 호출)
      const iRes = await fetch(
        `${BASE_URL}/uapi/domestic-stock/v1/quotations/foreign-institution-total?FID_COND_MRKT_DIV_CODE=V&FID_COND_SCR_DIV_CODE=16449&FID_INPUT_ISCD=${market}&FID_DIV_CLS_CODE=2&FID_RANK_SORT_CLS_CODE=0&FID_ETC_CLS_CODE=0`,
        { headers: { 'content-type': 'application/json', 'authorization': `Bearer ${token}`, 'appkey': APP_KEY, 'appsecret': APP_SECRET, 'tr_id': 'FHPTJ04400000', 'custtype': 'P' } }
      );
      const iData = await iRes.json();

      // 합치기 - 종목코드 기준 중복 제거, 외국인/기관 금액 모두 보존
      const codeMap = {};
      (fData.output || []).forEach(s => {
        codeMap[s.mksc_shrn_iscd] = { ...s };
      });
      (iData.output || []).forEach(s => {
        if(codeMap[s.mksc_shrn_iscd]) {
          // 이미 있으면 기관 금액만 업데이트
          codeMap[s.mksc_shrn_iscd].orgn_ntby_tr_pbmn = s.orgn_ntby_tr_pbmn;
          codeMap[s.mksc_shrn_iscd].orgn_ntby_qty = s.orgn_ntby_qty;
        } else {
          codeMap[s.mksc_shrn_iscd] = { ...s };
        }
      });

      return res.status(200).json({ output: Object.values(codeMap) });
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

      const codeList = codes.split(',').slice(0, 20); // 최대 20개

      // 순차 호출 (토큰 제한 방지)
      const results = [];
      for (const code of codeList) {
        try {
          const r = await fetch(`${BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-price?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=${code.trim()}`, {
            headers: {
              'content-type': 'application/json',
              'authorization': `Bearer ${token}`,
              'appkey': APP_KEY,
              'appsecret': APP_SECRET,
              'tr_id': 'FHKST01010100',
              'custtype': 'P'
            }
          });
          const d = await r.json();
          results.push({ code: code.trim(), ...d.output });
        } catch(e) {
          results.push({ code: code.trim() });
        }
      }

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
    if (action === 'chart_minute') {
      const token = await getToken();
      const { code = '069500' } = req.query;
      const now = new Date();
      // KST 기준 현재 시각
      const kstHour = (now.getUTCHours() + 9) % 24;
      const kstMin = now.getUTCMinutes();
      const hhmm = String(kstHour).padStart(2,'0') + String(kstMin).padStart(2,'0') + '00';
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 7000); // 7초 타임아웃
        const r = await fetch(
          `${BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice?FID_ETC_CLS_CODE=&FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=${code}&FID_INPUT_HOUR_1=${hhmm}&FID_PW_DATA_INCU_YN=Y`,
          { headers: { 'content-type': 'application/json', 'authorization': `Bearer ${token}`, 'appkey': APP_KEY, 'appsecret': APP_SECRET, 'tr_id': 'FHKST03010200', 'custtype': 'P' }, signal: controller.signal }
        );
        clearTimeout(timeout);
        const data = await r.json();
        if(data.rt_cd && data.rt_cd !== '0') {
          return res.status(200).json({ output1: {}, output2: [] });
        }
        const output2 = (data.output2 || []).sort((a,b) => a.stck_cntg_hour.localeCompare(b.stck_cntg_hour));
        return res.status(200).json({ output1: data.output1 || {}, output2 });
      } catch(e) {
        // 타임아웃 또는 오류시 빈 데이터 반환 (500 방지)
        return res.status(200).json({ output1: {}, output2: [], error: e.message });
      }
    }

    // 구글 뉴스 RSS - 증시 뉴스
    if (action === 'news') {
      try {
        const kw = req.query.q || '주식 증시 코스피';
        const query = encodeURIComponent(kw);
        const url = `https://news.google.com/rss/search?q=${query}&hl=ko&gl=KR&ceid=KR:ko`;
        const r = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/rss+xml,application/xml,text/xml' }
        });
        const xml = await r.text();
        const items = [];
        const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);
        for (const m of itemMatches) {
          const block = m[1];
          const title = (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || block.match(/<title>(.*?)<\/title>/) || [])[1] || '';
          const link  = (block.match(/<link>(.*?)<\/link>/)  || [])[1] || '';
          const pubDate = (block.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] || '';
          const source = (block.match(/<source[^>]*>(.*?)<\/source>/) || [])[1] || '';
          let displayTime = '';
          if(pubDate) {
            const d = new Date(pubDate);
            const kstD = new Date(d.getTime() + 9*60*60*1000);
            const mm = String(kstD.getUTCMonth()+1).padStart(2,'0');
            const dd = String(kstD.getUTCDate()).padStart(2,'0');
            const hh = String(kstD.getUTCHours()).padStart(2,'0');
            const mn = String(kstD.getUTCMinutes()).padStart(2,'0');
            displayTime = mm + '/' + dd + ' ' + hh + ':' + mn;
          }
          items.push({ title: title.trim(), link: link.trim(), pubDate: pubDate.trim(), source: source.trim(), displayTime });
          if(items.length >= 50) break;
        }
        items.sort((a,b) => new Date(b.pubDate) - new Date(a.pubDate));
        return res.status(200).json({ items: items.slice(0,20) });
      } catch(e) {
        return res.status(500).json({ error: e.message });
      }
    }

    // 상승/하락 종목 수 (KIS 시장 등락현황)
    if (action === 'market_breadth') {
      const token = await getToken();
      // FHPST01700000: 시장 등락현황 (코스피:0001, 코스닥:1001)
      const [kospiR, kosdaqR] = await Promise.all([
        fetch(`${BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-market-updown?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=0001&FID_BLNG_CLS_CODE=0`, {
          headers: { 'content-type': 'application/json', 'authorization': `Bearer ${token}`, 'appkey': APP_KEY, 'appsecret': APP_SECRET, 'tr_id': 'FHPST01700000', 'custtype': 'P' }
        }),
        fetch(`${BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-market-updown?FID_COND_MRKT_DIV_CODE=J&FID_INPUT_ISCD=1001&FID_BLNG_CLS_CODE=0`, {
          headers: { 'content-type': 'application/json', 'authorization': `Bearer ${token}`, 'appkey': APP_KEY, 'appsecret': APP_SECRET, 'tr_id': 'FHPST01700000', 'custtype': 'P' }
        })
      ]);
      const kp = await kospiR.json();
      const kq = await kosdaqR.json();
      return res.status(200).json({ kp, kq });
    }

    // 네이버 지수 차트 (코스피/코스닥 실제 지수)
    if (action === 'naver_index') {
      const { index = 'KOSPI' } = req.query;
      try {
        const r = await fetch(
          `https://m.stock.naver.com/api/index/${index}/price?timeframe=1D`,
          { headers: {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
            'Referer': 'https://m.stock.naver.com/',
            'Accept': 'application/json'
          }}
        );
        const data = await r.json();
        return res.status(200).json(data);
      } catch(e) {
        return res.status(500).json({ error: e.message });
      }
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
