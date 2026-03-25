import { describe, expect, mock, test } from 'bun:test'
import { schnorr } from '@noble/curves/secp256k1.js'
import { storeVoicemailAudio } from './voicemail-storage'

// Use real crypto with real keypairs instead of mocking the module
// (mock.module leaks across test files in Bun's test runner)
const privkey = schnorr.utils.randomSecretKey()
const pubkey = Buffer.from(schnorr.getPublicKey(privkey)).toString('hex')

describe('storeVoicemailAudio', () => {
  test('downloads, encrypts, stores, and deletes recording', async () => {
    const fakeAudio = new Uint8Array([0, 1, 2, 3])
    const mockAdapter = {
      getRecordingAudio: mock(async () => fakeAudio.buffer as ArrayBuffer),
      deleteRecording: mock(async () => {}),
    }
    const mockFiles = {
      createFileRecord: mock(async () => ({ id: 'file-123' })),
      putAssembled: mock(async () => {}),
      completeUpload: mock(async () => {}),
    }
    const mockRecords = {
      updateCallRecord: mock(async () => ({})),
    }

    const result = await storeVoicemailAudio({
      callSid: 'CA123',
      recordingSid: 'REC456',
      hubId: 'hub-1',
      adminPubkeys: [pubkey],
      adapter: mockAdapter as any,
      files: mockFiles as any,
      records: mockRecords as any,
      maxBytes: 2097152,
    })

    expect(mockAdapter.getRecordingAudio).toHaveBeenCalledWith('REC456')
    expect(mockFiles.putAssembled).toHaveBeenCalled()
    expect(mockFiles.createFileRecord).toHaveBeenCalled()
    expect(mockFiles.completeUpload).toHaveBeenCalled()
    expect(mockAdapter.deleteRecording).toHaveBeenCalledWith('REC456')
    expect(mockRecords.updateCallRecord).toHaveBeenCalledWith(
      'CA123',
      'hub-1',
      expect.objectContaining({ voicemailFileId: expect.any(String) })
    )
    expect(typeof result).toBe('string')
    expect(result).not.toBe('oversized')
  })

  test('returns oversized and keeps provider copy when audio exceeds maxBytes', async () => {
    const bigAudio = new Uint8Array(3_000_000)
    const mockAdapter = {
      getRecordingAudio: mock(async () => bigAudio.buffer as ArrayBuffer),
      deleteRecording: mock(async () => {}),
    }
    const mockFiles = {
      createFileRecord: mock(),
      putAssembled: mock(),
      completeUpload: mock(),
    }

    const result = await storeVoicemailAudio({
      callSid: 'CA123',
      recordingSid: 'REC456',
      hubId: 'hub-1',
      adminPubkeys: [pubkey],
      adapter: mockAdapter as any,
      files: mockFiles as any,
      records: { updateCallRecord: mock() } as any,
      maxBytes: 2097152,
    })

    expect(result).toBe('oversized')
    expect(mockAdapter.deleteRecording).not.toHaveBeenCalled()
    expect(mockFiles.putAssembled).not.toHaveBeenCalled()
  })

  test('throws when audio download returns null', async () => {
    const mockAdapter = {
      getRecordingAudio: mock(async () => null),
      deleteRecording: mock(async () => {}),
    }

    await expect(
      storeVoicemailAudio({
        callSid: 'CA123',
        recordingSid: 'REC_NULL',
        hubId: 'hub-1',
        adminPubkeys: [pubkey],
        adapter: mockAdapter as any,
        files: {} as any,
        records: {} as any,
        maxBytes: 2097152,
      })
    ).rejects.toThrow('Failed to download recording REC_NULL')
  })

  test('does not delete from provider when storage fails', async () => {
    const fakeAudio = new Uint8Array([0, 1, 2, 3])
    const mockAdapter = {
      getRecordingAudio: mock(async () => fakeAudio.buffer as ArrayBuffer),
      deleteRecording: mock(async () => {}),
    }
    const mockFiles = {
      createFileRecord: mock(async () => ({ id: 'file-abc' })),
      putAssembled: mock(async () => {
        throw new Error('MinIO unavailable')
      }),
      completeUpload: mock(async () => {}),
    }

    await expect(
      storeVoicemailAudio({
        callSid: 'CA999',
        recordingSid: 'REC999',
        hubId: 'hub-1',
        adminPubkeys: [pubkey],
        adapter: mockAdapter as any,
        files: mockFiles as any,
        records: { updateCallRecord: mock() } as any,
        maxBytes: 2097152,
      })
    ).rejects.toThrow('MinIO unavailable')

    expect(mockAdapter.deleteRecording).not.toHaveBeenCalled()
  })
})
