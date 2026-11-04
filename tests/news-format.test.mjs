import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseReport,inlineReport,reportUrl} from '../public/chat/news/report-format.js';
const all=nodes=>nodes.flatMap(n=>[n,...all(n.children||[])]);
test('concert report renders adjacent headings, bold, tables, alignment and numbered sources',()=>{
  const blocks=parseReport('# 공연 소식\n**새 공연입니다.**\n\n| 좌석 | 가격 |\n|---|---:|\n| SS석 | **¥27,000** |\n| S\\|A | `a|b` |\n\n### 예매 안내\n공식 발표 [1]',[{title:'공식 발표',url:'https://example.org/concert'}]);
  const nodes=all(blocks);assert.equal(blocks[0].type,'heading');assert.equal(blocks[1].type,'p');
  assert.equal(nodes.filter(n=>n.type==='table').length,1);assert.equal(nodes.filter(n=>n.type==='tr').length,3);
  assert(nodes.some(n=>n.type==='td'&&n.align==='right'));assert(nodes.some(n=>n.type==='text'&&n.value==='S|A'));
  assert(nodes.some(n=>n.type==='code'&&n.children[0].value==='a|b'));assert.equal(nodes.filter(n=>n.type==='strong').length,2);
  assert(nodes.some(n=>n.type==='a'&&n.citation&&n.href==='https://example.org/concert'));
});
test('job report preserves lists, nested details, links and paragraphs after a list',()=>{
  const blocks=parseReport('### 공고\n- **근무지:** 서울\n- **지원:** [지원하기](https://example.org/jobs/(unity))\n  - 추가 조건\n\n우선순위를 확인하세요.\n\n3. 첫 단계\n4. 다음 단계');
  const nodes=all(blocks);assert.equal(nodes.filter(n=>n.type==='ul').length,2);assert.equal(nodes.filter(n=>n.type==='li').length,5);
  assert(nodes.some(n=>n.type==='a'&&n.href==='https://example.org/jobs/(unity)'));assert.equal(blocks.at(-1).start,3);
  assert(nodes.some(n=>n.type==='text'&&n.value==='우선순위를 확인하세요.'));
});
test('untrusted HTML remains text and executable or credential-bearing URLs never become links',()=>{
  const nodes=all(parseReport('<img src=x onerror=alert(1)>\n\n[실행](javascript:alert(1)) [비밀](https://user:pass@example.org) [파일](data:text/html,evil)\n\n```html\n<script>alert(1)</script>\n```'));
  assert(!nodes.some(n=>n.type==='a'||n.type==='img'||n.type==='script'));assert(nodes.some(n=>n.type==='text'&&n.value.includes('<img')));
  assert(nodes.some(n=>n.type==='code'&&n.children[0].value.includes('<script>')));
  assert.equal(reportUrl('javascript:alert(1)'),null);assert.equal(reportUrl('//example.org'),null);
  assert.equal(inlineReport('\\*literal\\*')[0].value,'*literal*');
});
