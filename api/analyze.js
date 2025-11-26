export default async function handler(request, response) {
  if (request.method !== 'POST')
    return response.status(405).json({ error: 'Method Not Allowed' });
  const { productName, imageUrl, apiKey } = request.body;

  try {
    // 画像データの準備
    let imagePart = null;
    if (imageUrl) {
      const imgRes = await fetch(imageUrl);
      const arrayBuffer = await imgRes.arrayBuffer();
      imagePart = {
        inlineData: {
          data: Buffer.from(arrayBuffer).toString('base64'),
          mimeType: imgRes.headers.get('content-type') || 'image/jpeg',
        },
      };
    }

    // Geminiへの指示
    const systemInstruction = `
      あなたは知的財産権侵害チェックの専門家です。
      JSON形式のみで回答してください: { "risk_level": "高"|"中"|"低", "reason": "短い理由" }
      - 高: 偽ブランド、著作権侵害の明白な疑い
      - 中: パロディ、グレーゾーン
      - 低: 一般商品
    `;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
    const contents = [
      { role: 'user', parts: [{ text: `商品名: ${productName}` }] },
    ];
    if (imagePart) contents[0].parts.push(imagePart);

    const aiRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: contents,
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig: { responseMimeType: 'application/json' },
      }),
    });

    const aiData = await aiRes.json();
    const text = aiData.candidates?.[0]?.content?.parts?.[0]?.text;

    return response.status(200).json(JSON.parse(text));
  } catch (error) {
    return response
      .status(500)
      .json({ risk_level: 'エラー', reason: error.message });
  }
}
