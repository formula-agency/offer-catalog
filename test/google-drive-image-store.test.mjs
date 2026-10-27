import test from 'node:test';
import assert from 'node:assert/strict';
import { driveImageErrorInfo, extractDriveFileId } from '../src/google-drive-image-store.mjs';

test('Drive links expose the file ID without publishing the viewer URL', () => {
  assert.equal(extractDriveFileId('https://drive.google.com/file/d/1Pxqtyoi7dFryJoqJ-h7cI7m2-PcnKBtR/view'), '1Pxqtyoi7dFryJoqJ-h7cI7m2-PcnKBtR');
  assert.equal(extractDriveFileId('https://drive.google.com/open?id=17nIPBKAP2IotohCkYfSIfppFIP9-pzau'), '17nIPBKAP2IotohCkYfSIfppFIP9-pzau');
});

test('Drive permission and missing-file responses are actionable and non-retryable', () => {
  assert.deepEqual(driveImageErrorInfo({ response: { status: 403 } }), {
    code: 'image_access_denied',
    message: 'Нет доступа к файлу изображения в Google Drive.',
    retryable: false
  });
  assert.deepEqual(driveImageErrorInfo({ response: { status: 404 } }), {
    code: 'image_not_found',
    message: 'Файл изображения не найден или сервисному аккаунту не выдан доступ.',
    retryable: false
  });
});

test('temporary and transport errors retain retryability', () => {
  assert.equal(driveImageErrorInfo({ response: { status: 503 } }).retryable, true);
  assert.equal(driveImageErrorInfo(new Error('network')).retryable, true);
  assert.equal(driveImageErrorInfo({ response: { status: 400 } }).retryable, false);
});
