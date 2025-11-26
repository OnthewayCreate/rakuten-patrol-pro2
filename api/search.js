export default async function handler(request, response) {
  if (request.method !== 'GET') return response.status(405).json({ error: 'Method Not Allowed' });
  const { shopUrl, appId, page = 1 } = request.query;

  if (!shopUrl || !appId) {
    return response.status(400).json({ error: 'URLと楽天アプリIDが必要です' });
  }

  try {
    // --- ショップID特定ロジック (強化版) ---
    let shopCode = '';
    try {
      const decodedUrl = decodeURIComponent(shopUrl);
      const urlObj = new URL(decodedUrl);
      const pathParts = urlObj.pathname.split('/').filter(p => p);

      // パターン1: www.rakuten.co.jp/SHOP_CODE/
      if (urlObj.hostname === 'www.rakuten.co.jp') {
        shopCode = pathParts[0];
      }
      // パターン2: www.rakuten.ne.jp/gold/SHOP_CODE/
      else if (urlObj.hostname === 'www.rakuten.ne.jp' && pathParts[0] === 'gold') {
        shopCode = pathParts[1];
      }
      // パターン3: item.rakuten.co.jp/SHOP_CODE/ITEM_ID/
      else if (urlObj.hostname === 'item.rakuten.co.jp') {
        shopCode = pathParts[0];
      }
      
      // 除外ワードのチェック（カテゴリページなど誤検知防止）
      const ignored = ['search', 'category', 'event', 'review', 'gold'];
      if (ignored.includes(shopCode)) {
        // パスが除外ワードの場合、次の要素を見てみる
        shopCode = pathParts.find(p => !ignored.includes(p)) || '';
      }

    } catch (e) {
      console.error("URL Parse Error:", e);
    }

    if (!shopCode) {
      return response.status(400).json({ error: 'ショップIDを特定できませんでした。正しいショップトップページのURLを入力してください。' });
    }

    // --- 楽天API呼び出し ---
    const rakutenApiUrl = `https://app.rakuten.co.jp/services/api/IchibaItem/Search/20170706?format=json&shopCode=${shopCode}&applicationId=${appId}&hits=30&page=${page}&imageFlag=1`;
    
    const res = await fetch(rakutenApiUrl);
    
    if (!res.ok) {
        if (res.status === 429) return response.status(429).json({ error: '楽天APIの制限を超えました。しばらく待ってください。' });
        const errText = await res.text();
        return response.status(res.status).json({ error: `楽天APIエラー: ${res.status}`, details: errText });
    }

    const data = await res.json();
    
    // エラーレスポンスのハンドリング
    if (data.error) {
       return response.status(400).json({ error: data.error_description || '楽天APIからエラーが返されました' });
    }

    const products = data.Items.map(item => ({
      name: item.Item.itemName,
      price: item.Item.itemPrice,
      url: item.Item.itemUrl,
      // 画像URLの末尾にあるクエリ(?ex=...)を削除して綺麗なURLにする
      imageUrl: item.Item.mediumImageUrls?.[0]?.imageUrl?.split('?')[0] || null
    }));

    return response.status(200).json({ shopCode, products, count: data.count });
  } catch (error) {
    return response.status(500).json({ error: 'サーバー内部エラー', details: error.message });
  }
}