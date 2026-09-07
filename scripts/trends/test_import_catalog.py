import unittest
from import_catalog import prepare, normalize, read_records
from pathlib import Path
from tempfile import TemporaryDirectory

class ImportTests(unittest.TestCase):
    def row(self, **changes):
        return dict(title='Test', prompt='A prompt\nwith lines', kind='image', **changes)

    def test_repeat_source_updates_same_identity(self):
        a = self.row(source_url='https://example.com/prompt/1')
        b = {**a, 'prompt': 'Updated prompt'}
        result = prepare([a, b])
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['prompt'], 'Updated prompt')
        self.assertNotIn('imported_at', result[0])

    def test_reject_unsafe_media_and_invalid_score(self):
        for value in ['javascript:alert(1)', '//example.com/image', 'https://user:pass@example.com/image']:
            with self.assertRaises(ValueError): normalize(self.row(thumbnail_url=value))
        for value in ['NaN', 'Infinity', -1]:
            with self.assertRaises(ValueError): normalize(self.row(popularity=value))

    def test_csv_preserves_multiline_and_tags(self):
        with TemporaryDirectory() as folder:
            path = Path(folder) / 'export.csv'
            path.write_text('title,prompt,kind,categories\nTest,"Line one\nLine two",video,Action|Film\n')
            result = prepare(read_records(path))[0]
            self.assertEqual(result['prompt'], 'Line one\nLine two')
            self.assertEqual(result['categories'], ['Action', 'Film'])

    def test_invalid_record_aborts_entire_validation(self):
        with self.assertRaisesRegex(ValueError, 'Record 2'):
            prepare([self.row(), {'title': 'Incomplete'}])

if __name__ == '__main__': unittest.main()
