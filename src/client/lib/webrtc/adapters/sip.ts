import type { WebRTCAdapter, WebRtcEvent, WebRtcEventHandler } from '../types'

export class SipWebRTCAdapter implements WebRTCAdapter {
  async initialize(_token: string): Promise<void> {
    throw new Error('Not implemented')
  }
  async accept(_callSid: string): Promise<void> {
    throw new Error('Not implemented')
  }
  async reject(_callSid: string): Promise<void> {
    throw new Error('Not implemented')
  }
  disconnect(): void {}
  setMuted(_muted: boolean): void {}
  isMuted(): boolean {
    return false
  }
  on<E extends WebRtcEvent>(_event: E, _handler: WebRtcEventHandler<E>): void {}
  off<E extends WebRtcEvent>(_event: E, _handler: WebRtcEventHandler<E>): void {}
  destroy(): void {}
}
