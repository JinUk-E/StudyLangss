#!/usr/bin/env python3
"""Deliver a report through Codex's authenticated MCP client, without reading credentials."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import selectors
import subprocess
import time

ROOT=Path(__file__).resolve().parents[2]

class CodexMCP:
    def __init__(self):
        self.process=subprocess.Popen(['codex','app-server','--listen','stdio://'],cwd=ROOT,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
        self.counter=0
        self.buffer=b''
        self.selector=selectors.DefaultSelector()
        self.selector.register(self.process.stdout,selectors.EVENT_READ)
    def call(self,method,params):
        self.counter+=1
        ident=self.counter
        self.process.stdin.write((json.dumps({'jsonrpc':'2.0','id':ident,'method':method,'params':params})+'\n').encode())
        self.process.stdin.flush()
        deadline=time.monotonic()+55
        while time.monotonic()<deadline:
            if b'\n' not in self.buffer:
                if not self.selector.select(timeout=1):continue
                chunk=os.read(self.process.stdout.fileno(),65536)
                if not chunk:raise RuntimeError('Codex connection closed')
                self.buffer+=chunk
                continue
            line,self.buffer=self.buffer.split(b'\n',1)
            try:message=json.loads(line)
            except ValueError:continue
            if message.get('id')!=ident:continue
            if 'error' in message:raise RuntimeError('Codex RPC failed: '+method)
            return message.get('result')
        raise TimeoutError('Codex RPC timed out: '+method)
    def initialize(self):
        self.call('initialize',{'clientInfo':{'name':'starlight_news_delivery','version':'0.5.0'},'capabilities':{'experimentalApi':True}})
        self.process.stdin.write(b'{"method":"initialized","params":{}}\n')
        self.process.stdin.flush()
        # A transient MCP context only: no model turn, persistent conversation or credential export.
        self.thread=self.call('thread/start',{'ephemeral':True,'cwd':str(ROOT)})['thread']['id']
        # Thread creation can return before remote MCP discovery has completed.
        deadline=time.monotonic()+45
        required={'list_news_topics','publish_news_report','get_news_delivery_status'}
        while time.monotonic()<deadline:
            status=self.call('mcpServerStatus/list',{'serverName':'starlight-news','threadId':self.thread,'detail':'toolsAndAuthOnly'})
            servers=[s for s in status.get('data',[]) if s.get('name')=='starlight-news']
            if not servers:raise RuntimeError('Register the starlight-news MCP connection in Codex first')
            server=servers[0]
            if server.get('runtimeStatus')=='connected' and required.issubset(server.get('tools',{})):return
            if server.get('runtimeStatus') in ['authenticationRequired','failed','cancelled','disabled']:
                raise RuntimeError('Codex news connection is unavailable; check its connection and login status')
            time.sleep(.3)
        raise TimeoutError('Codex news tools did not become ready')
    def tool(self,name,args):
        result=self.call('mcpServer/tool/call',{'server':'starlight-news','threadId':self.thread,'tool':name,'arguments':args})
        if result.get('isError'):raise RuntimeError('MCP tool failed: '+name)
        data=result.get('structuredContent')
        if not isinstance(data,dict):raise RuntimeError('MCP response missing structured result')
        return data
    def close(self):
        self.selector.close()
        self.process.terminate()
        try:self.process.wait(timeout=3)
        except subprocess.TimeoutExpired:self.process.kill();self.process.wait()

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('report',nargs='?',type=Path)
    parser.add_argument('--topics',action='store_true')
    options=parser.parse_args()
    if not options.topics and not options.report:parser.error('Provide a report JSON file or --topics')
    report=None
    if options.report:
        if options.report.stat().st_size>65536:raise ValueError('Report exceeds size limit')
        report=json.loads(options.report.read_text())
        if not isinstance(report,dict) or not isinstance(report.get('topic'),str):raise ValueError('Invalid report topic')
    client=CodexMCP()
    try:
        client.initialize()
        topics=client.tool('list_news_topics',{})
        if options.topics:print(json.dumps(topics,ensure_ascii=False));return
        if report['topic'] not in [t['id'] for t in topics['topics']]:raise RuntimeError('Server does not support this topic')
        result=client.tool('publish_news_report',report)
        if result.get('saved') is not True:raise RuntimeError('Delivery was not confirmed')
        check=client.tool('get_news_delivery_status',{'topic':report['topic'],'deliveryId':report['deliveryId']})
        if not check.get('found') or check.get('id')!=result.get('id'):raise RuntimeError('Delivery confirmation mismatch')
        directory=ROOT/'data/chat/news-sync/receipts'
        directory.mkdir(parents=True,exist_ok=True,mode=0o700)
        key=hashlib.sha256((report['topic']+':'+report['deliveryId']).encode()).hexdigest()
        path=directory/(key+'.json')
        receipt={**result,'deliveryId':report['deliveryId'],'reportDate':report['reportDate'],'sources':report['sources']}
        path.write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n')
        path.chmod(0o600)
        print(json.dumps(result,ensure_ascii=False))
    finally:client.close()

if __name__=='__main__':main()
