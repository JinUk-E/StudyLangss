import importlib.util
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('naver_mail', 'scripts/news/naver_mail.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class Mail:
    def __init__(self, *args, **kwargs): self.calls = []
    def login(self, *args): self.calls.append(('login',))
    def select(self, mailbox, readonly=False):
        self.calls.append(('select', mailbox, readonly)); return 'OK', []
    def uid(self, action, *args):
        self.calls.append((action, *args))
        if action == 'search': return 'OK', [b'1 2']
        headers = b'Subject: Interview invitation\r\nFrom: jobs@example.com\r\nDate: Thu, 5 Nov 2026 09:00:00 +0900\r\n\r\n' if args[0] == b'2' else b'Subject: Hello\r\nFrom: friend@example.com\r\n\r\n'
        return 'OK', [(b'header', headers)]
    def logout(self): self.calls.append(('logout',))

class Tests(unittest.TestCase):
    def test_readonly_peek_and_filter(self):
        mail = Mail()
        with patch.object(module, 'get_credentials', return_value=('user', 'secret')), patch.object(module.imaplib, 'IMAP4_SSL', return_value=mail):
            result = module.collect()
        self.assertEqual(result['scanned'], 2)
        self.assertEqual([i['subject'] for i in result['items']], ['Interview invitation'])
        self.assertIn(('select', 'INBOX', True), mail.calls)
        self.assertTrue(all('BODY.PEEK[HEADER.FIELDS' in call[2] for call in mail.calls if call[0] == 'fetch'))
        self.assertEqual(mail.calls[-1], ('logout',))

if __name__ == '__main__': unittest.main()
