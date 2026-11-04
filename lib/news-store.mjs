import { createHash, randomUUID, randomBytes, timingSafeEqual } from 'node:crypto';
import { assert } from './validation.mjs';

export const NEWS_TOPICS=Object.freeze([{id:'jpop',name:'J-POP 공연 알림',description:'공연 소식과 예매 일정을 모아 봐요.'},{id:'twins',name:'LG 트윈스 소식',description:'경기와 구단 소식을 한곳에서 확인해요.'},{id:'milan',name:'AC 밀란 소식',description:'로쏘네리의 경기와 구단 소식을 모아 봐요.'},{id:'jobs',name:'주간 채용 소식',description:'Unity/C# 채용 공고와 지원 우선순위를 모아 봐요.'}]);
const hash=value=>createHash('sha256').update(value).digest('hex');
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
export function validateNews(input,topics=NEWS_TOPICS) {
  assert(object(input),'리포트 객체가 필요합니다.');
  assert(Object.keys(input).every(k=>['topic','deliveryId','title','body','reportDate','sources'].includes(k)),'지원하지 않는 리포트 항목입니다.');
  assert(topics.some(t=>t.id===input.topic),'소식 종류를 선택하세요.');
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
    CREATE TABLE IF NOT EXISTS news_bridge (singleton INTEGER PRIMARY KEY CHECK(singleton=1), digest TEXT NOT NULL, ownerRevision INTEGER NOT NULL, createdAt TEXT NOT NULL, lastUsedAt TEXT);
    CREATE TABLE IF NOT EXISTS news_topics (id TEXT PRIMARY KEY, name TEXT NOT NULL, normalizedName TEXT UNIQUE NOT NULL, query TEXT NOT NULL, sourceUrls TEXT NOT NULL, theme TEXT NOT NULL, autoCollect INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 1, requestId TEXT UNIQUE NOT NULL, digest TEXT NOT NULL, createdAt TEXT NOT NULL);`);
  const topicRow=row=>({...row,sourceUrls:JSON.parse(row.sourceUrls),autoCollect:!!row.autoCollect,custom:true,description:row.query});
  const topics=()=>[...NEWS_TOPICS.map(t=>({...t,custom:false})),...db.prepare('SELECT id,name,query,sourceUrls,theme,autoCollect,revision,createdAt FROM news_topics ORDER BY createdAt,id').all().map(topicRow)];
  const normalized=value=>value.normalize('NFKC').trim().toLowerCase();
  function validateTopic(input){
    assert(object(input)&&Object.keys(input).every(k=>['name','query','sourceUrls','theme','autoCollect','requestId','revision'].includes(k)),'관심 주제 항목을 확인하세요.');
    for(const [key,max,label] of [['name',50,'주제 이름'],['query',500,'받고 싶은 소식']])assert(typeof input[key]==='string'&&input[key].trim()&&input[key].length<=max&&!/[\x00-\x1f]/.test(input[key]),`${label}을 ${max}자 이내로 입력하세요.`);
    assert(['violet','rose','green','red','blue'].includes(input.theme),'카드 색상을 선택하세요.');
    assert(typeof input.autoCollect==='boolean','자동 소식 받기 설정을 확인하세요.');
    assert(Array.isArray(input.sourceUrls)&&input.sourceUrls.length<=5,'공식 출처는 최대 5개까지 등록할 수 있습니다.');
    const sourceUrls=input.sourceUrls.map(value=>{
      assert(typeof value==='string'&&value.length<=2000,'출처 주소를 확인하세요.');let url;
      try{url=new URL(value);}catch{assert(false,'출처는 HTTPS 주소로 입력하세요.');}
      assert(url.protocol==='https:'&&!url.username&&!url.password&&!url.hash&&!url.port&&!url.hostname.startsWith('[')&&url.hostname.includes('.')&&!/^[\d.]+$/.test(url.hostname)&&!url.hostname.endsWith('.local')&&!url.hostname.endsWith('.localhost'),'출처는 공개된 공식 사이트의 HTTPS 주소로 입력하세요.');
      return url.href;
    });
    return {name:input.name.trim(),query:input.query.trim(),sourceUrls:[...new Set(sourceUrls)],theme:input.theme,autoCollect:input.autoCollect};
  }
  const unpack=row=>row?{...row,sources:JSON.parse(row.sources)}:null;
  const get=id=>unpack(db.prepare('SELECT id,topic,title,body,reportDate,sources,receivedAt,origin FROM news_reports WHERE id=?').get(id));
  return {
    get,
    topics,
    addTopic(input){
      const value=validateTopic(input);assert(typeof input.requestId==='string'&&/^[a-f0-9-]{36}$/.test(input.requestId),'저장 요청을 다시 시작하세요.');
      const digest=hash(JSON.stringify(value)),old=db.prepare('SELECT id,digest FROM news_topics WHERE requestId=?').get(input.requestId);
      if(old){assert(old.digest===digest,'같은 요청의 내용이 변경되었습니다. 다시 저장하세요.',409);return {topic:topics().find(t=>t.id===old.id),duplicate:true};}
      assert(topics().length<24,'관심 주제는 최대 24개까지 등록할 수 있습니다.',409);
      assert(!topics().some(t=>normalized(t.name)===normalized(value.name)),'같은 이름의 관심 주제가 있습니다.',409);
      const id='custom-'+randomUUID();db.prepare('INSERT INTO news_topics (id,name,normalizedName,query,sourceUrls,theme,autoCollect,requestId,digest,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,value.name,normalized(value.name),value.query,JSON.stringify(value.sourceUrls),value.theme,Number(value.autoCollect),input.requestId,digest,new Date().toISOString());
      return {topic:topics().find(t=>t.id===id),duplicate:false};
    },
    updateTopic(id,input){
      assert(topics().some(t=>t.custom&&t.id===id),'직접 등록한 주제를 선택하세요.',404);const value=validateTopic(input);
      assert(Number.isSafeInteger(input.revision)&&input.revision>0,'주제를 새로 불러온 뒤 수정하세요.');
      assert(!topics().some(t=>t.id!==id&&normalized(t.name)===normalized(value.name)),'같은 이름의 관심 주제가 있습니다.',409);
      const result=db.prepare('UPDATE news_topics SET name=?,normalizedName=?,query=?,sourceUrls=?,theme=?,autoCollect=?,revision=revision+1 WHERE id=? AND revision=?').run(value.name,normalized(value.name),value.query,JSON.stringify(value.sourceUrls),value.theme,Number(value.autoCollect),id,input.revision);
      assert(result.changes===1,'다른 화면에서 수정된 주제입니다. 새로 불러온 뒤 수정하세요.',409);return {topic:topics().find(t=>t.id===id)};
    },
    list(topic) {assert(topics().some(t=>t.id===topic),'소식 종류를 선택하세요.');return db.prepare('SELECT id,topic,title,substr(body,1,200) AS preview,reportDate,receivedAt,origin FROM news_reports WHERE topic=? ORDER BY reportDate DESC,receivedAt DESC LIMIT 100').all(topic);},
    publish(input,origin='chatgpt') {
      const value=validateNews(input,topics()),digest=hash(JSON.stringify(value));
      const old=db.prepare('SELECT id,digest FROM news_reports WHERE topic=? AND deliveryId=?').get(value.topic,value.deliveryId);
      if(old){assert(old.digest===digest,'같은 전달 ID에 다른 내용이 있습니다. 새 회차 ID를 사용하세요.',409);return {saved:true,duplicate:true,report:get(old.id)};}
      assert(db.prepare('SELECT count(*) AS n FROM news_reports').get().n<5000,'소식 보관함이 가득 찼습니다. 운영자 확인이 필요합니다.',409);
      const id=randomUUID();db.prepare('INSERT INTO news_reports VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,value.topic,value.deliveryId,digest,value.title,value.body,value.reportDate,JSON.stringify(value.sources),new Date().toISOString(),origin);
      return {saved:true,duplicate:false,report:get(id)};
    },
    delivery(topic,id) {assert(topics().some(t=>t.id===topic)&&typeof id==='string'&&id.length<=160,'전달 ID를 확인하세요.');const row=db.prepare('SELECT id,receivedAt FROM news_reports WHERE topic=? AND deliveryId=?').get(topic,id);return row?{found:true,id:row.id,receivedAt:row.receivedAt}:{found:false};},
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
