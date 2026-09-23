// Photo bytes use signed uploads, avoiding function request payload limits.
export async function POST() {return Response.json({error:'화면을 새로고침한 뒤 사진을 다시 올려 주세요.'},{status:410});}
