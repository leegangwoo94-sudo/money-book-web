// Supabase Edge Function 'proxy' — 야후/네이버 시세를 브라우저 대신 받아오는 CORS 프록시
// 배포: Supabase 대시보드 → Edge Functions → Deploy a new function → 이름 'proxy' → 이 코드 붙여넣기 → Deploy
// 허용된 호스트만 통과시키는 화이트리스트 방식 (남용 방지)

const ALLOW = [
  'query1.finance.yahoo.com',
  'query2.finance.yahoo.com',
  'm.stock.naver.com',
  'finance.naver.com',
];

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const raw = new URL(req.url).searchParams.get('url');
  let target: URL;
  try {
    target = new URL(raw ?? '');
  } catch {
    return new Response('bad url', { status: 400, headers: cors });
  }
  if (!ALLOW.includes(target.hostname)) {
    return new Response('forbidden host', { status: 403, headers: cors });
  }

  try {
    const upstream = await fetch(target, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
    });
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        ...cors,
        'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json',
        'Cache-Control': 'public, max-age=300', // 5분 캐시
      },
    });
  } catch (e) {
    return new Response(String(e), { status: 502, headers: cors });
  }
});
