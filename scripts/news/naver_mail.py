#!/usr/bin/env python3
"""Read-only, on-demand Naver recruitment mail headers. Credentials stay in macOS Keychain."""
import ctypes
import ctypes.util
import email
import email.header
import getpass
import imaplib
import json
import re
import subprocess
import sys
from email.utils import parsedate_to_datetime

SERVICE = 'org.starlightforge.naver-mail'
KEYWORDS = re.compile(r'채용|면접|입사지원|지원서|서류전형|합격|불합격|전형결과|인재영입|recruit|interview|job application|hiring', re.I)

def decode(value):
    return ''.join(part.decode(enc or 'utf-8', errors='replace') if isinstance(part, bytes) else part for part, enc in email.header.decode_header(value or ''))[:500]

def setup():
    existing = subprocess.run(['/usr/bin/security', 'find-generic-password', '-s', SERVICE], capture_output=True, timeout=15)
    if existing.returncode == 0:
        raise ValueError('이미 연결된 계정이 있습니다. 키체인 접근에서 별빛공방 메일 항목을 삭제하고 다시 등록하세요.')
    account = input('네이버 아이디: ').strip().removesuffix('@naver.com')
    if not re.fullmatch(r'[A-Za-z0-9_-]{2,50}', account):
        raise ValueError('네이버 아이디를 확인해 주세요.')
    password = getpass.getpass('네이버 애플리케이션 비밀번호: ').encode()
    if not 1 <= len(password) <= 256:
        raise ValueError('비밀번호를 확인해 주세요.')
    # Keychain Services avoids passing a password in command-line arguments or files.
    security = ctypes.CDLL(ctypes.util.find_library('Security'))
    service, user = SERVICE.encode(), account.encode()
    security.SecKeychainAddGenericPassword.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_char_p, ctypes.c_uint32, ctypes.c_char_p, ctypes.c_uint32, ctypes.c_char_p, ctypes.c_void_p]
    result = security.SecKeychainAddGenericPassword(None, len(service), service, len(user), user, len(password), password, None)
    if result == -25299:
        raise ValueError('이미 등록된 계정입니다. 키체인 접근에서 기존 항목을 삭제하고 다시 등록하세요.')
    if result:
        raise RuntimeError('macOS 키체인에 저장하지 못했습니다.')
    print('키체인에 저장했습니다. 별빛공방에서 채용 메일을 확인하세요.')

def get_credentials():
    # Ask Keychain for the account and password separately; never print either.
    result = subprocess.run(['/usr/bin/security', 'find-generic-password', '-s', SERVICE], capture_output=True, text=True, timeout=15)
    if result.returncode:
        raise RuntimeError('키체인에 네이버 메일이 연결되지 않았거나 접근이 허용되지 않았습니다.')
    account = re.search(r'"acct"<blob>="([^"\n]+)"', result.stdout)
    if not account or not re.fullmatch(r'[A-Za-z0-9_-]{2,50}', account.group(1)):
        raise RuntimeError('등록된 네이버 아이디를 확인할 수 없습니다.')
    secret = subprocess.run(['/usr/bin/security', 'find-generic-password', '-s', SERVICE, '-a', account.group(1), '-w'], capture_output=True, text=True, timeout=15)
    if secret.returncode:
        raise RuntimeError('키체인 접근이 허용되지 않았습니다.')
    return account.group(1), secret.stdout.rstrip('\n')

def collect():
    account, password = get_credentials()
    mail = imaplib.IMAP4_SSL('imap.naver.com', 993, timeout=20)
    try:
        mail.login(account, password)
        status, _ = mail.select('INBOX', readonly=True)
        if status != 'OK':
            raise RuntimeError('받은 메일함을 열 수 없습니다.')
        status, data = mail.uid('search', None, 'ALL')
        if status != 'OK':
            raise RuntimeError('메일 목록을 조회하지 못했습니다.')
        ids = data[0].split()[-100:][::-1]
        items = []
        for uid in ids:
            status, parts = mail.uid('fetch', uid, '(BODY.PEEK[HEADER.FIELDS (SUBJECT FROM DATE)])')
            if status != 'OK':
                raise RuntimeError('메일 헤더를 조회하지 못했습니다.')
            raw = next((part[1] for part in parts if isinstance(part, tuple)), None)
            if not raw:
                continue
            msg = email.message_from_bytes(raw)
            subject, sender = decode(msg.get('Subject')), decode(msg.get('From'))
            if not KEYWORDS.search(subject + ' ' + sender):
                continue
            try:
                date = parsedate_to_datetime(msg.get('Date')).isoformat()
            except (TypeError, ValueError, OverflowError):
                date = ''
            items.append({'subject': subject, 'sender': sender, 'date': date})
        return {'items': items, 'scanned': len(ids), 'limit': 100, 'method': '제목·발신자 키워드'}
    finally:
        try: mail.logout()
        except Exception: pass

if __name__ == '__main__':
    try:
        if sys.argv[1:] == ['setup']:
            setup()
        elif sys.argv[1:] == ['collect']:
            print(json.dumps(collect(), ensure_ascii=False))
        else:
            raise ValueError('지원하지 않는 명령입니다.')
    except Exception as exc:
        print(json.dumps({'error': str(exc) if isinstance(exc, (ValueError, RuntimeError)) else '메일 연결 또는 조회에 실패했습니다. IMAP 설정과 인증 상태를 확인해 주세요.'}, ensure_ascii=False))
        sys.exit(1)
