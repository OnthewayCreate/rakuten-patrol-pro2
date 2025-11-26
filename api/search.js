export default async function handler(request, response) {
  if (request.method !== 'GET')
    return response.status(405).json({ error: 'Method Not Allowed' });
  const { shopUrl, appId, page = 1 } = request.query;

  try {
    // URLからショップIDを特定する簡易ロジック
    let shopCode = '';
    try {
      const urlObj = new URL(decodeURIComponent(shopUrl));
      const pathParts = urlObj.pathname.split('/').filter((p) => p);
      // https://www.rakuten.co.jp/SHOP_CODE/ のパターン
      if (pathParts.length > 0) shopCode = pathParts[0];
    } catch (e) {}

    if (!shopCode)
      return response
        .status(400)
        .json({ error: 'ショップIDを特定できませんでした' });

    // 楽天API呼び出し
    const rakutenApiUrl = `https://app.rakuten.co.jp/services/api/IchibaItem/Search/20170706?format=json&shopCode=${shopCode}&applicationId=${appId}&hits=30&page=${page}&imageFlag=1`;
    const res = await fetch(rakutenApiUrl);

    if (!res.ok)
      return response.status(res.status).json({ error: '楽天APIエラー' });
    const data = await res.json();

    const products = data.Items.map((item) => ({
      name: item.Item.itemName,
      price: item.Item.itemPrice,
      url: item.Item.itemUrl,
      imageUrl: item.Item.mediumImageUrls?.[0]?.imageUrl?.split('?')[0] || null,
    }));

    return response.status(200).json({ shopCode, products });
  } catch (error) {
    return response.status(500).json({ error: error.message });
  }
}
