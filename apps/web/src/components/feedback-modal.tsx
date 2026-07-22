'use client';

import Image from 'next/image';
import { useState } from 'react';
import { submitFeedback } from '../lib/api';

interface Props {
  householdId?: string | null;
  onClose: () => void;
}

type CategoryType = 'SUGGESTION' | 'BUG' | 'EXPERIENCE' | 'OTHER';

const CATEGORIES: Array<{ type: CategoryType; label: string; icon: string }> = [
  { type: 'SUGGESTION', label: '功能建议', icon: '💡' },
  { type: 'BUG', label: '问题反馈', icon: '🐛' },
  { type: 'EXPERIENCE', label: '体验感受', icon: '✨' },
  { type: 'OTHER', label: '其他', icon: '💬' },
];

const RATING_LABELS = ['很不满意', '不太满意', '一般', '满意', '非常满意'];

export function FeedbackModal({ householdId, onClose }: Props) {
  const [category, setCategory] = useState<CategoryType>('SUGGESTION');
  const [rating, setRating] = useState<number | null>(5);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [content, setContent] = useState('');
  const [contact, setContact] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) {
      setError('请输入反馈内容');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await submitFeedback({
        household_id: householdId || null,
        category,
        content: content.trim(),
        rating,
        contact: contact.trim() || null,
      });
      setSuccess(true);
      setTimeout(() => {
        onClose();
      }, 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败，请稍后重试');
      setSubmitting(false);
    }
  };

  const activeRating = hoverRating !== null ? hoverRating : rating;

  return (
    <div
      className="feedback-modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="feedback-modal-card">
        <button
          type="button"
          className="feedback-modal-close"
          onClick={onClose}
          aria-label="关闭"
        >
          ✕
        </button>

        {success ? (
          <div className="feedback-success-state">
            <div className="feedback-success-icon">
              <Image
                src="/mascot/xiaozhi.png"
                width={80}
                height={80}
                alt="小知"
                style={{ objectFit: 'contain' }}
              />
            </div>
            <h3>收到您的反馈啦！</h3>
            <p>感谢对鲜知 AI 冰箱内测的支持，小知已把您的建议记下 ❤️</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="feedback-header">
              <div className="feedback-avatar">
                <Image
                  src="/mascot/xiaozhi.png"
                  width={44}
                  height={44}
                  alt="小知"
                  style={{ objectFit: 'contain' }}
                />
              </div>
              <div>
                <h3>内测反馈与建议</h3>
                <p>告诉小知您的想法，让我们一起把鲜知做得更好！</p>
              </div>
            </div>

            <div className="feedback-field">
              <label className="feedback-label">反馈类型</label>
              <div className="feedback-categories">
                {CATEGORIES.map((item) => (
                  <button
                    key={item.type}
                    type="button"
                    className={`feedback-category-chip ${category === item.type ? 'active' : ''}`}
                    onClick={() => setCategory(item.type)}
                  >
                    <span>{item.icon}</span>
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="feedback-field">
              <div className="feedback-label-row">
                <label className="feedback-label">整体评分（选填）</label>
                {activeRating ? (
                  <span className="feedback-rating-hint">
                    {RATING_LABELS[activeRating - 1]}
                  </span>
                ) : null}
              </div>
              <div className="feedback-stars">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    className={`feedback-star ${(activeRating ?? 0) >= star ? 'filled' : ''}`}
                    onMouseEnter={() => setHoverRating(star)}
                    onMouseLeave={() => setHoverRating(null)}
                    onClick={() => setRating(rating === star ? null : star)}
                  >
                    ★
                  </button>
                ))}
              </div>
            </div>

            <div className="feedback-field">
              <label className="feedback-label">详细描述 <span>*</span></label>
              <textarea
                className="feedback-textarea"
                rows={4}
                maxLength={1000}
                placeholder="请详细描述您遇到的问题、功能建议或改进意见…"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                required
              />
              <div className="feedback-char-count">{content.length} / 1000</div>
            </div>

            <div className="feedback-field">
              <label className="feedback-label">联系方式（选填）</label>
              <input
                type="text"
                className="feedback-input"
                placeholder="微信号 / 手机号 / 邮箱（方便我们回复您）"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
              />
            </div>

            {error ? <div className="feedback-error">{error}</div> : null}

            <div className="feedback-actions">
              <button
                type="button"
                className="feedback-btn-cancel"
                onClick={onClose}
                disabled={submitting}
              >
                取消
              </button>
              <button
                type="submit"
                className="feedback-btn-submit"
                disabled={submitting || !content.trim()}
              >
                {submitting ? '提交中…' : '提交反馈'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
