import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from inspect_attachment import inspect_file, OLE


class AttachmentTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def write(self, name, data):
        p = self.root / name
        p.write_bytes(data)
        return p

    def test_missing(self):
        self.assertEqual(inspect_file(self.root / 'missing.pdf')['status'], 'UNVERIFIED')

    def test_html_error_disguised_as_pdf(self):
        r = inspect_file(self.write('bad.pdf', b'<html>502</html>'))
        self.assertIn('signature mismatch', r['reason'])
        self.assertFalse(r['source_verified'])

    def test_unsupported_hwp_signature(self):
        self.assertEqual(inspect_file(self.write('bad.hwp', b'not HWP'))['status'], 'UNVERIFIED')

    def test_hwp_parser_unavailable(self):
        with patch('inspect_attachment.shutil.which', return_value=None):
            r = inspect_file(self.write('annex.hwp', OLE + b'fake'))
        self.assertEqual(r['status'], 'UNVERIFIED')
        self.assertIn('hwp5txt', r['reason'])
        self.assertNotIn('text', r)

    def test_corrupt_pdf(self):
        r = inspect_file(self.write('broken.pdf', b'%PDF-1.7\ninvalid'))
        self.assertEqual(r['status'], 'UNVERIFIED')

    def test_size_limit(self):
        with patch('inspect_attachment.MAX_BYTES', 4):
            self.assertEqual(inspect_file(self.write('large.pdf', b'%PDF-1.7'))['status'], 'UNVERIFIED')

    def test_real_pdf_text_extraction(self):
        from reportlab.pdfgen import canvas
        p = self.root / 'fixture.pdf'
        c = canvas.Canvas(str(p))
        c.drawString(30, 800, 'Synthetic annex fixture: 123')
        c.showPage()
        c.drawString(30, 800, 'Second page: 456')
        c.save()
        r = inspect_file(p)
        self.assertEqual(r['status'], 'TEXT_EXTRACTED_LOCAL')
        self.assertIn('Synthetic annex fixture: 123', r['text'])
        self.assertIn('Second page: 456', r['text'])
        self.assertEqual(r['sha256'], hashlib.sha256(p.read_bytes()).hexdigest())
        self.assertFalse(r['source_verified'])
        self.assertFalse(r['layout_verified'])

    def test_empty_pdf_text(self):
        from reportlab.pdfgen import canvas
        p = self.root / 'blank.pdf'
        c = canvas.Canvas(str(p))
        c.showPage()
        c.save()
        self.assertEqual(inspect_file(p)['status'], 'UNVERIFIED')


if __name__ == '__main__':
    unittest.main()
