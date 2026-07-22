import { Inject, Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../../infra/db/database.module';

export interface CreateFeedbackDto {
  household_id?: string | null;
  category: 'SUGGESTION' | 'BUG' | 'EXPERIENCE' | 'OTHER';
  content: string;
  rating?: number | null;
  contact?: string | null;
}

export interface FeedbackItem {
  id: string;
  household_id: string | null;
  household_name: string | null;
  category: string;
  content: string;
  rating: number | null;
  contact: string | null;
  status: string;
  created_at: string;
}

export interface FeedbackStats {
  total: number;
  suggestions: number;
  bugs: number;
  experience: number;
  others: number;
  open: number;
  resolved: number;
  avg_rating: number | null;
}

@Injectable()
export class FeedbackService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async createFeedback(dto: CreateFeedbackDto): Promise<FeedbackItem> {
    if (!dto.content || !dto.content.trim()) {
      throw new BadRequestException('反馈内容不能为空');
    }

    const validCategories = ['SUGGESTION', 'BUG', 'EXPERIENCE', 'OTHER'];
    const category = validCategories.includes(dto.category) ? dto.category : 'SUGGESTION';

    let rating: number | null = null;
    if (typeof dto.rating === 'number' && dto.rating >= 1 && dto.rating <= 5) {
      rating = Math.round(dto.rating);
    }

    const result = await this.pool.query<FeedbackItem>(
      `insert into beta_feedbacks (household_id, category, content, rating, contact)
       values ($1, $2, $3, $4, $5)
       returning id, household_id, category, content, rating, contact, status, created_at`,
      [dto.household_id || null, category, dto.content.trim(), rating, dto.contact?.trim() || null],
    );

    const item = result.rows[0];
    if (!item) {
      throw new BadRequestException('创建内测反馈失败');
    }

    return item;
  }

  async getFeedbacks(
    limit = 30,
    offset = 0,
    category?: string,
    status?: string,
  ): Promise<{ items: FeedbackItem[]; total: number; stats: FeedbackStats }> {
    const cappedLimit = Math.min(Math.max(limit, 1), 100);
    const validOffset = Math.max(offset, 0);

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (category) {
      params.push(category);
      conditions.push(`f.category = $${params.length}`);
    }

    if (status) {
      params.push(status);
      conditions.push(`f.status = $${params.length}`);
    }

    const whereClause = conditions.length ? `where ${conditions.join(' and ')}` : '';

    const listParams = [...params, cappedLimit, validOffset];
    const itemsResult = await this.pool.query<FeedbackItem>(
      `select
         f.id,
         f.household_id,
         h.name as household_name,
         f.category,
         f.content,
         f.rating,
         f.contact,
         f.status,
         f.created_at
       from beta_feedbacks f
       left join households h on h.id = f.household_id
       ${whereClause}
       order by f.created_at desc
       limit $${listParams.length - 1} offset $${listParams.length}`,
      listParams,
    );

    const countResult = await this.pool.query<{ count: string }>(
      `select count(*)::text as count from beta_feedbacks f ${whereClause}`,
      params,
    );
    const total = Number(countResult.rows[0]?.count || 0);

    // Compute overall stats across all feedback
    const statsResult = await this.pool.query<{
      total: string;
      suggestions: string;
      bugs: string;
      experience: string;
      others: string;
      open: string;
      resolved: string;
      avg_rating: string | null;
    }>(
      `select
         count(*)::text as total,
         count(*) filter (where category = 'SUGGESTION')::text as suggestions,
         count(*) filter (where category = 'BUG')::text as bugs,
         count(*) filter (where category = 'EXPERIENCE')::text as experience,
         count(*) filter (where category = 'OTHER')::text as others,
         count(*) filter (where status = 'OPEN')::text as open,
         count(*) filter (where status = 'RESOLVED')::text as resolved,
         round(avg(rating)::numeric, 1)::text as avg_rating
       from beta_feedbacks`,
    );

    const rawStats = statsResult.rows[0];
    const stats: FeedbackStats = {
      total: Number(rawStats?.total || 0),
      suggestions: Number(rawStats?.suggestions || 0),
      bugs: Number(rawStats?.bugs || 0),
      experience: Number(rawStats?.experience || 0),
      others: Number(rawStats?.others || 0),
      open: Number(rawStats?.open || 0),
      resolved: Number(rawStats?.resolved || 0),
      avg_rating: rawStats?.avg_rating ? Number(rawStats.avg_rating) : null,
    };

    return {
      items: itemsResult.rows,
      total,
      stats,
    };
  }

  async updateStatus(id: string, status: string): Promise<FeedbackItem> {
    if (!['OPEN', 'RESOLVED'].includes(status)) {
      throw new BadRequestException('状态必须为 OPEN 或 RESOLVED');
    }

    const result = await this.pool.query<FeedbackItem>(
      `update beta_feedbacks
       set status = $1
       where id = $2
       returning id, household_id, category, content, rating, contact, status, created_at`,
      [status, id],
    );

    const item = result.rows[0];
    if (!item) {
      throw new NotFoundException('找不到对应反馈');
    }

    return item;
  }
}
