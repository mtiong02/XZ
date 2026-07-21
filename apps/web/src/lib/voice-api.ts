'use client';

import { apiPost } from './api';

export interface VoiceCandidate {
  command_type: string;
  payload: {
    items?: {
      food_id: string;
      display_text?: string;
      quantity: string;
      unit: string;
      quantity_explicit?: boolean;
    }[];
    food_ids?: string[];
    food_id?: string;
    food_name?: string;
    reminder_text?: string;
    scheduled_for?: string;
    reminder_id?: string;
  };
}

export interface DialogueTurn {
  role: 'user' | 'system';
  text: string;
  at: string;
}

export type VoiceJobStatus =
  | 'PROCESSING'
  | 'AWAITING_CONFIRMATION'
  | 'AWAITING_CLARIFICATION'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED';

export interface VoiceJob {
  voice_job_id: string;
  household_id: string;
  status: VoiceJobStatus;
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
  // 系统要"说出来"的话（前端用 TTS 合成播报）
  spoken_prompt: string | null;
  turn_count: number;
  dialogue_turns: DialogueTurn[];
}

/** 语音多轮对话推进：用户对系统播报的口头回应（"对"/"不对"/"改成三盒"）。 */
export function replyVoiceJob(jobId: string, text: string): Promise<VoiceJob> {
  return apiPost<VoiceJob>(`/voice-jobs/${jobId}/reply`, { text });
}

/** 该状态是否还在等待用户下一轮回应。 */
export function isAwaitingReply(status: VoiceJobStatus): boolean {
  return status === 'AWAITING_CONFIRMATION' || status === 'AWAITING_CLARIFICATION';
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
