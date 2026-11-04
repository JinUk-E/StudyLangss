import { createHash, randomUUID, randomBytes, timingSafeEqual } from 'node:crypto';
import { assert } from './validation.mjs';

export const NEWS_TOPICS=Object.freeze([{id:'jpop',name:'J-POP 공연 알림',description:'공연 소식과 예매 일정을 모아 봐요.'},{id:'twins',name:'LG 트윈스 소식',description:'경기와 구단 소식을 한곳에서 확인해요.'}]);
const hash=value=>createHash('sha256').update(value).digest('hex');
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
export function validateNews(input) {
  assert(object(input),'리포트 객체가 필요합니다.');
  assert(Object.keys(input).every(k=>['topic','deliveryId','title','body','reportDate','sources'].includes(k)),'지원하지 않는 리포트 항목입니다.');
  assert(NEWS_TOPICS.some(t=>t.id===input.topic),'소식 종류를 선택하세요.');
  assert(typeof input.deliveryId==='string'&&/^[A-Za-z0-9._:-]{8,160}$/.test(input.deliveryId),'전달 ID는 영문·숫자·._:-로 8~160자여야 합니다.');
  assert(typeof input.title==='string'&&input.title.trim()&&input.title.length<=160&&!/[\x00-\x1f]/.test(input.title),'제목은 한 줄, 160자 이내여야 합니다.');
  assert(typeof input.body==='string'&&input.body.trim()&&input.body.length<=18000&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(input.body),'본문은 1~18,000자로 작성하세요.');
  assert(typeof input.reportDate==='string'&&/^20\d\d-\d{2}-\d{2}$/.test(input.reportDate)&&Number.isFinite(Date.parse(input.reportDate))&&new Date(input.reportDate).toISOString().slice(0,10)===input.reportDate,'리포트 기준일을 YYYY-MM-DD로 입력하세요.');
  assert(Array.isArray(input.sources)&&input.sources.length>=1&&input.sources.length<=20,'확인한 출처를 1~20개 포함하세요.');
  const sources=input.sources.map(s=>{
    assert(object(s)&&Object.keys(s).every(k=>['title','url'].includes(k))&&typeof s.title==='string'&&s.title.trim()&&s.title.length<=250&&typeof s.url==='string'&&s.url.length<=2000,'출처 제목과 URL을 확인하세요.');
    let url;try{url=new URL(s.url);}catch{assert(false,'출처 URL을 확인하세요.');}
    assert(url.protocol==='https:'&&!url.username&&!url.password&&!url.hash&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname),'출처는 자격 증명이 없는 HTTPS URL이어야 합니다.');
    return {title:s.title.trim(),url:url.href};
  });
  return {topic:input.topic,deliveryId:input.deliveryId,title:input.title.trim(),body:input.body.trim(),reportDate:input.reportDate,sources};
}
export function createNewsStore(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS news_reports (id TEXT PRIMARY KEY, topic TEXT NOT NULL, deliveryId TEXT NOT NULL, digest TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, reportDate TEXT NOT NULL, sources TEXT NOT NULL, receivedAt TEXT NOT NULL, origin TEXT NOT NULL, UNIQUE(topic,deliveryId));
    CREATE INDEX IF NOT EXISTS news_topic_date ON news_reports(topic,reportDate DESC,receivedAt DESC);
    CREATE TABLE IF NOT EXISTS news_bridge (singleton INTEGER PRIMARY KEY CHECK(singleton=1), digest TEXT NOT NULL, ownerRevision INTEGER NOT NULL, createdAt TEXT NOT NULL, lastUsedAt TEXT);`);
  const unpack=row=>row?{...row,sources:JSON.parse(row.sources)}:null;
  const get=id=>unpack(db.prepare('SELECT id,topic,title,body,reportDate,sources,receivedAt,origin FROM news_reports WHERE id=?').get(id));
  return {
    get,
    list(topic) {assert(NEWS_TOPICS.some(t=>t.id===topic),'소식 종류를 선택하세요.');return db.prepare('SELECT id,topic,title,substr(body,1,200) AS preview,reportDate,receivedAt,origin FROM news_reports WHERE topic=? ORDER BY reportDate DESC,receivedAt DESC LIMIT 100').all(topic);},
    publish(input,origin='chatgpt') {
      const value=validateNews(input),digest=hash(JSON.stringify(value));
      const old=db.prepare('SELECT id,digest FROM news_reports WHERE topic=? AND deliveryId=?').get(value.topic,value.deliveryId);
      if(old){assert(old.digest===digest,'같은 전달 ID에 다른 내용이 있습니다. 새 회차 ID를 사용하세요.',409);return {saved:true,duplicate:true,report:get(old.id)};}
      assert(db.prepare('SELECT count(*) AS n FROM news_reports').get().n<5000,'소식 보관함이 가득 찼습니다. 운영자 확인이 필요합니다.',409);
      const id=randomUUID();db.prepare('INSERT INTO news_reports VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,value.topic,value.deliveryId,digest,value.title,value.body,value.reportDate,JSON.stringify(value.sources),new Date().toISOString(),origin);
      return {saved:true,duplicate:false,report:get(id)};
    },
    delivery(topic,id) {assert(NEWS_TOPICS.some(t=>t.id===topic)&&typeof id==='string'&&id.length<=160,'전달 ID를 확인하세요.');const row=db.prepare('SELECT id,receivedAt FROM news_reports WHERE topic=? AND deliveryId=?').get(topic,id);return row?{found:true,id:row.id,receivedAt:row.receivedAt}:{found:false};},
    connection() {const row=db.prepare('SELECT ownerRevision,createdAt,lastUsedAt FROM news_bridge WHERE singleton=1').get();return row?{enabled:true,...row}:{enabled:false};},
    issue(ownerRevision) {const token='sf_news_'+randomBytes(32).toString('base64url');db.prepare('INSERT OR REPLACE INTO news_bridge VALUES (1,?,?,?,NULL)').run(hash(token),ownerRevision,new Date().toISOString());return token;},
    revoke(){db.prepare('DELETE FROM news_bridge').run();},
    authenticate(authorization,accounts) {
      const row=db.prepare('SELECT * FROM news_bridge WHERE singleton=1').get();
      const token=typeof authorization==='string'&&authorization.startsWith('Bearer ')?authorization.slice(7):'';
      if(!row||token.length>200||!timingSafeEqual(Buffer.from(hash(token),'hex'),Buffer.from(row.digest,'hex'))||!accounts.current({id:'owner',revision:row.ownerRevision},'admin'))return false;
      db.prepare('UPDATE news_bridge SET lastUsedAt=? WHERE singleton=1').run(new Date().toISOString());return true;
    }
  };
}
