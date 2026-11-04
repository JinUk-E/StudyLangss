// Deliberately render only report formatting, never model-provided HTML.
const node=(type,children=[],extra={})=>({type,children,...extra});
const text=value=>({type:'text',value});
export function reportUrl(value){
  try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}
}
export function inlineReport(value,sources=[],depth=0){
  if(depth>8)return [text(value)];
  const result=[];let plain='';
  const flush=()=>{if(plain){result.push(text(plain));plain='';}};
  for(let i=0;i<value.length;){
    if(value[i]==='\\'&&/[\\`*_[\]{}()#+.!|>-]/.test(value[i+1]||'')){plain+=value[i+1];i+=2;continue;}
    if(value[i]==='`'){
      const end=value.indexOf('`',i+1);if(end>i+1){flush();result.push(node('code',[text(value.slice(i+1,end))]));i=end+1;continue;}
    }
    if(value[i]==='['){
      const labelEnd=value.indexOf(']',i+1);
      if(labelEnd>i&&value[labelEnd+1]==='('){
        let end=labelEnd+2,balance=1;
        for(;end<value.length;end++){if(value[end]==='\\'){end++;continue;}if(value[end]==='(')balance++;if(value[end]===')'&&!--balance)break;}
        if(balance===0){
          flush();const label=value.slice(i+1,labelEnd),href=reportUrl(value.slice(labelEnd+2,end).trim());
          const children=inlineReport(label,sources,depth+1);result.push(...(href?[node('a',children,{href})]:children));i=end+1;continue;
        }
      }
      const citation=value.slice(i).match(/^\[(\d{1,2})\]/),source=citation&&sources[Number(citation[1])-1];
      if(source&&reportUrl(source.url)){flush();result.push(node('a',[text(citation[0])],{href:reportUrl(source.url),citation:true,title:source.title}));i+=citation[0].length;continue;}
    }
    const delimiter=['**','__','~~','*','_'].find(d=>value.startsWith(d,i));
    if(delimiter){
      const end=value.indexOf(delimiter,i+delimiter.length);
      if(end>i+delimiter.length){flush();result.push(node(delimiter==='~~'?'del':delimiter.length===2?'strong':'em',inlineReport(value.slice(i+delimiter.length,end),sources,depth+1)));i=end+delimiter.length;continue;}
    }
    plain+=value[i++];
  }
  flush();return result;
}
function cells(line){
  let value=line.trim();if(value.startsWith('|'))value=value.slice(1);if(value.endsWith('|')&&!value.endsWith('\\|'))value=value.slice(0,-1);
  const result=[];let current='',code=false;
  for(let i=0;i<value.length;i++){
    if(value[i]==='\\'&&value[i+1]==='|'){current+='|';i++;continue;}
    if(value[i]==='`')code=!code;
    if(value[i]==='|'&&!code){result.push(current.trim());current='';}else current+=value[i];
  }
  result.push(current.trim());return result;
}
const listItem=line=>line.match(/^(\s*)([-+*]|\d+[.)])\s+(.+)$/);
const rule=line=>/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line);
const heading=line=>line.match(/^\s{0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/);
const tableStart=(lines,i)=>lines[i]?.includes('|')&&lines[i+1]?.includes('|')&&cells(lines[i+1]).every(c=>/^:?-{3,}:?$/.test(c));
export function parseReport(value,sources=[],depth=0){
  if(depth>8)return [node('p',[text(value)])];
  const lines=value.replace(/\r\n?/g,'\n').split('\n'),blocks=[];
  const inline=s=>inlineReport(s,sources);
  for(let i=0;i<lines.length;){
    if(!lines[i].trim()){i++;continue;}
    const h=heading(lines[i]);
    if(h){blocks.push(node('heading',inline(h[2]),{level:h[1].length}));i++;continue;}
    if(rule(lines[i])){blocks.push(node('hr'));i++;continue;}
    const fence=lines[i].match(/^\s*(`{3,}|~{3,})(.*)$/);
    if(fence){const content=[];i++;while(i<lines.length&&!lines[i].trim().startsWith(fence[1]))content.push(lines[i++]);if(i<lines.length)i++;blocks.push(node('pre',[node('code',[text(content.join('\n'))])]));continue;}
    if(tableStart(lines,i)){
      const headers=cells(lines[i]),align=cells(lines[i+1]).map(c=>c.startsWith(':')&&c.endsWith(':')?'center':c.endsWith(':')?'right':'left');i+=2;
      const rows=[];while(i<lines.length&&lines[i].includes('|')&&lines[i].trim())rows.push(cells(lines[i++]));
      blocks.push(node('table',[node('thead',[node('tr',headers.map((v,j)=>node('th',inline(v),{align:align[j]||'left'})))]),node('tbody',rows.map(row=>node('tr',headers.map((_,j)=>node('td',inline(row[j]||''),{align:align[j]||'left'})))))]));continue;
    }
    const first=listItem(lines[i]);
    if(first){
      const indent=first[1].length,ordered=/\d/.test(first[2]),items=[];
      while(i<lines.length){
        const item=listItem(lines[i]);if(!item||item[1].length!==indent||/\d/.test(item[2])!==ordered)break;
        const content=[item[3]],prefix=item[0].length-item[3].length;i++;
        while(i<lines.length){
          if(!lines[i].trim()){
            let next=i+1;while(next<lines.length&&!lines[next].trim())next++;
            const nextItem=listItem(lines[next]||'');
            if(nextItem&&nextItem[1].length===indent&&/\d/.test(nextItem[2])===ordered){i=next;break;}
            if(next<lines.length&&/^\s+/.test(lines[next])&&lines[next].match(/^\s*/)[0].length>indent){content.push('');i++;continue;}
            break;
          }
          const padding=lines[i].match(/^\s*/)[0].length;
          if(padding<=indent)break;
          content.push(lines[i++].slice(Math.min(prefix,padding)));
        }
        items.push(node('li',parseReport(content.join('\n'),sources,depth+1)));
      }
      blocks.push(node(ordered?'ol':'ul',items,ordered?{start:parseInt(first[2],10)}:{}));continue;
    }
    if(/^\s*>/.test(lines[i])){const quote=[];while(i<lines.length&&/^\s*>/.test(lines[i]))quote.push(lines[i++].replace(/^\s*> ?/,''));blocks.push(node('blockquote',parseReport(quote.join('\n'),sources,depth+1)));continue;}
    const paragraph=[lines[i++]];
    while(i<lines.length&&lines[i].trim()&&!heading(lines[i])&&!rule(lines[i])&&!listItem(lines[i])&&!/^\s*(>|`{3,}|~{3,})/.test(lines[i])&&!tableStart(lines,i))paragraph.push(lines[i++]);
    blocks.push(node('p',paragraph.flatMap((line,j)=>[...(j?[node('br')]:[]),...inline(line)])));
  }
  return blocks;
}
export function renderReport(target,value,sources=[],title=''){
  const doc=target.ownerDocument;
  const create=part=>{
    if(part.type==='text')return doc.createTextNode(part.value);
    const element=doc.createElement(part.type==='heading'?'h'+Math.min(6,Math.max(3,part.level+1)):part.type);
    if(part.type==='a'){element.href=part.href;element.target='_blank';element.rel='noopener noreferrer';if(part.citation){element.className='report-citation';element.title=part.title;}}
    if(part.type==='ol'&&part.start!==1)element.start=part.start;
    if(part.type==='th')element.scope='col';
    if(part.align)element.className='align-'+part.align;
    for(const child of part.children)element.append(create(child));
    if(part.type==='table'){const wrap=doc.createElement('div');wrap.className='report-table';wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label','리포트 정보 표 · 좌우로 스크롤할 수 있습니다');wrap.append(element);return wrap;}
    return element;
  };
  const fragment=doc.createDocumentFragment();let section;
  const blocks=parseReport(value,sources);
  const plain=part=>part.type==='text'?part.value:part.children.map(plain).join('');
  if(blocks[0]?.type==='heading'&&plain(blocks[0]).trim()===title.trim())blocks.shift();
  for(const block of blocks){
    if(!section||(block.type==='heading'&&block.level<=2)){
      section=doc.createElement('section');section.className='report-section';fragment.append(section);
    }
    section.append(create(block));
  }
  target.replaceChildren(fragment);
}
