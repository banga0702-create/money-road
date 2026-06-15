// api/cron.js - 매일 15:35 KST 자동 실행
import admin from 'firebase-admin';

// Firebase Admin 초기화 (싱글톤)
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

// KIS API 토큰
let _token = null;
let _tokenExp = 0;

async function getToken() {
  const now = Date.now();
  if (_token && now < _tokenExp) return _token;

  const APP_KEY = process.env.KIS_APP_KEY;
  const APP_SECRET = process.env.KIS_APP_SECRET;

  const res = await fetch('https://openapi.koreainvestment.com:9443/oauth2/tokenP', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', appkey: APP_KEY, appsecret: APP_SECRET })
  });
  const data = await res.json();
  _token = data.access_token;
  _tokenExp = now + (data.expires_in - 60) * 1000;
  return _token;
}

async function fetchForeignInstCombined() {
  const token = await getToken();
  const APP_KEY = process.env.KIS_APP_KEY;
  const APP_SECRET = process.env.KIS_APP_SECRET;

  const headers = {
    'authorization': `Bearer ${token}`,
    'appkey': APP_KEY,
    'appsecret': APP_SECRET,
    'tr_id': 'FHPTJ04400000',
    'Content-Type': 'application/json'
  };

  // 코스피 외국인 TOP30
  const fKospi = await fetch('https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/quotations/foreign-institution-total?fid_cond_mrkt_div_code=J&fid_cond_scr_div_code=20174&fid_input_iscd=0001&fid_div_cls_code=0&fid_rank_sort_cls_code=0&fid_input_cnt_1=0', { headers });
  const fKospiData = await fKospi.json();
  await new Promise(r => setTimeout(r, 300));

  // 코스닥 외국인 TOP30  
  const fKosdaq = await fetch('https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/quotations/foreign-institution-total?fid_cond_mrkt_div_code=J&fid_cond_scr_div_code=20174&fid_input_iscd=1001&fid_div_cls_code=0&fid_rank_sort_cls_code=0&fid_input_cnt_1=0', { headers });
  const fKosdaqData = await fKosdaq.json();
  await new Promise(r => setTimeout(r, 300));

  // 코스피 기관 TOP30
  const iKospi = await fetch('https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/quotations/foreign-institution-total?fid_cond_mrkt_div_code=J&fid_cond_scr_div_code=20174&fid_input_iscd=0001&fid_div_cls_code=1&fid_rank_sort_cls_code=0&fid_input_cnt_1=0', { headers });
  const iKospiData = await iKospi.json();
  await new Promise(r => setTimeout(r, 300));

  // 코스닥 기관 TOP30
  const iKosdaq = await fetch('https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/quotations/foreign-institution-total?fid_cond_mrkt_div_code=J&fid_cond_scr_div_code=20174&fid_input_iscd=1001&fid_div_cls_code=1&fid_rank_sort_cls_code=0&fid_input_cnt_1=0', { headers });
  const iKosdaqData = await iKosdaq.json();

  // 합치기
  const codeMap = {};
  [...(fKospiData.output||[]), ...(fKosdaqData.output||[])].forEach(s => {
    codeMap[s.mksc_shrn_iscd] = { ...s };
  });
  [...(iKospiData.output||[]), ...(iKosdaqData.output||[])].forEach(s => {
    if (codeMap[s.mksc_shrn_iscd]) {
      codeMap[s.mksc_shrn_iscd].orgn_ntby_tr_pbmn = s.orgn_ntby_tr_pbmn;
      codeMap[s.mksc_shrn_iscd].orgn_ntby_qty = s.orgn_ntby_qty;
    } else {
      codeMap[s.mksc_shrn_iscd] = { ...s };
    }
  });

  return Object.values(codeMap).map(s => {
    const fBuy = Math.round(parseFloat(s.frgn_ntby_tr_pbmn||0) / 100);
    const iBuy = Math.round(parseFloat(s.orgn_ntby_tr_pbmn||0) / 100);
    const trPbmn = Math.round(parseFloat(s.acml_tr_pbmn||0) / 100000000);
    const ratio = trPbmn > 0 ? +((fBuy + iBuy) / trPbmn * 100).toFixed(1) : 0;
    return {
      name: s.hts_kor_isnm,
      code: s.mksc_shrn_iscd,
      fBuy, iBuy, trPbmn, ratio,
      chg: parseFloat(s.prdy_ctrt||0),
      sector: s.bstp_kor_isnm||'',
      currentPrice: parseInt(s.stck_prpr||s.prdy_clpr||0),
    };
  });
}

export default async function handler(req, res) {
  // Vercel Cron은 Authorization 헤더로 검증
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    // Vercel Cron 자동실행은 통과
    if (!req.headers['x-vercel-cron']) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    const today = new Date().toISOString().slice(0, 10);
    
    // 1. 순매수TOP 데이터 조회
    const all = await fetchForeignInstCombined();
    if (!all.length) return res.status(200).json({ message: '데이터 없음' });

    // 2. 수급 30%↑ 종목 필터
    const targets = all.filter(s => (s.ratio||0) >= 30);

    // 3. 모든 유저 가져오기
    const usersSnap = await db.collection('users').get();
    
    for (const userDoc of usersSnap.docs) {
      const uid = userDoc.id;

      // 4. 자동투자 처리
      const simRef = db.collection('users').doc(uid).collection('simData').doc('main');
      const simSnap = await simRef.get();
      const simData = simSnap.exists ? simSnap.data() : { holdings: [], history: [] };
      const holdings = simData.holdings || [];

      let added = 0;
      for (const s of targets) {
        // 이미 보유 중이면 스킵
        if (holdings.find(h => h.name === s.name && !h.soldAt)) continue;
        if (!s.currentPrice) continue;
        const qty = s.currentPrice >= 1000000 ? 1 : Math.floor(1000000 / s.currentPrice);
        if (!qty) continue;
        holdings.push({
          id: Date.now() + Math.random(),
          name: s.name, code: s.code||'',
          sector: s.sector||'',
          buyPrice: s.currentPrice, qty,
          buyAmount: s.currentPrice * qty,
          buyDate: today,
          ratio: s.ratio,
          currentPrice: s.currentPrice,
          signal: 'hold',
          reEntryCount: 0
        });
        added++;
        await new Promise(r => setTimeout(r, 100));
      }

      if (added > 0) {
        await simRef.set({ ...simData, holdings, updatedAt: Date.now() });
      }

      // 5. 수급1등 저장
      const top1 = [...all].sort((a, b) => (b.ratio||0) - (a.ratio||0))[0];
      if (top1 && top1.ratio > 0) {
        const sudRef = db.collection('users').doc(uid).collection('sudTop1').doc('history');
        const sudSnap = await sudRef.get();
        const sudData = sudSnap.exists ? sudSnap.data() : { list: [] };
        const list = sudData.list || [];
        if (!list.find(d => d.date === today)) {
          list.unshift({ date: today, name: top1.name, code: top1.code||'', ratio: top1.ratio, chg: top1.chg||0, sector: top1.sector||'' });
          await sudRef.set({ list, updatedAt: Date.now() });
        }
      }
    }

    return res.status(200).json({ message: `완료: ${targets.length}개 30%↑, ${today}` });
  } catch (e) {
    console.error('Cron 오류:', e);
    return res.status(500).json({ error: e.message });
  }
}
