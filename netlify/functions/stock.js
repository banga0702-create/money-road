exports.handler = async (event) => {
  const { code } = event.queryStringParameters || {};
  
  if (!code) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: '종목코드가 필요해요' })
    };
  }

  const API_KEY = 'd7f011931a4f7d1929ddfd4d5423f9d74410918fadd1bbb7a12cdc7b9cf5a5e5';
  const url = `https://apis.data.go.kr/1160100/service/GetStockSecuritiesInfoService/getStockPriceInfo?serviceKey=${API_KEY}&numOfRows=1&pageNo=1&resultType=json&likeSrtnCd=${code}`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    const items = data?.response?.body?.items?.item;
    
    if (!items || items.length === 0) {
      return {
        statusCode: 404,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: '종목을 찾을 수 없어요' })
      };
    }

    const item = Array.isArray(items) ? items[0] : items;
    
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        name: item.itmsNm,
        code: item.srtnCd,
        price: item.clpr,
        change: item.vs,
        changeRate: item.fltRt,
        volume: item.trqu,
        tradingValue: item.trPrc,
        high: item.hipr,
        low: item.lopr,
        open: item.mkp,
        date: item.basDt,
      })
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: '서버 오류: ' + e.message })
    };
  }
};
