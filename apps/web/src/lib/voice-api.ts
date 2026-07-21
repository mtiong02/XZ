'use client';

import { apiPost } from './api';

export interface VoiceCandidate {
  command_type: string;
  payload: {
    items?: { food_id: string; display_text?: string; quantity: string; unit: string }[];
    food_ids?: string[];
  };
}

export interface VoiceJob {
  voice_job_id: string;
  household_id: string;
  status: 'PROCESSING' | 'AWAITING_CONFIRMATION' | 'COMPLETED' | 'CANCELLED' | 'FAILED';
  transcript: { raw: string; normalized: string } | null;
  candidate_command: VoiceCandidate | null;
  confidence: {
    intent: number;
    food_entity: number;
    quantity: number;
    overall: number;
  } | null;
  requires_confirmation: boolean;
  error_code: string | null;
}

/** 文本通道：把识别到的文本交给服务端解析流水线（docs/03 §5）。 */
export function createTextVoiceJob(
  householdId: string,
  transcriptText: string,
  channel: string,
): Promise<VoiceJob> {
  return apiPost<VoiceJob>('/voice-jobs', {
    household_id: householdId,
    transcript_text: transcriptText,
    channel,
    client_request_id: crypto.randomUUID(),
  });
}

export function confirmVoiceJob(jobId: string, payload?: unknown): Promise<unknown> {
  return apiPost(`/voice-jobs/${jobId}/confirm`, payload === undefined ? {} : { payload });
}

export function cancelVoiceJob(jobId: string): Promise<unknown> {
  return apiPost(`/voice-jobs/${jobId}/cancel`, {});
}
