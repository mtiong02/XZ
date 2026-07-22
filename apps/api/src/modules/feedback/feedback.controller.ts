import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { FeedbackService, type CreateFeedbackDto } from './feedback.service';

@Controller()
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  private checkAdminToken(token: string | undefined) {
    const adminToken = process.env.ADMIN_TOKEN;
    if (!adminToken || token !== adminToken) {
      throw new ForbiddenException('Invalid admin token');
    }
  }

  /**
   * POST /api/v1/feedback
   * 收集用户内测反馈
   */
  @Post('feedback')
  async submitFeedback(@Body() body: CreateFeedbackDto) {
    const feedback = await this.feedbackService.createFeedback(body);
    return {
      success: true,
      message: '感谢您的内测反馈！',
      data: feedback,
    };
  }

  /**
   * GET /api/v1/admin/feedbacks
   * 管理员查询内测反馈汇总与列表
   */
  @Get('admin/feedbacks')
  async getAdminFeedbacks(
    @Headers('x-admin-token') token: string | undefined,
    @Query('limit') limitStr?: string,
    @Query('offset') offsetStr?: string,
    @Query('category') category?: string,
    @Query('status') status?: string,
  ) {
    this.checkAdminToken(token);
    const limit = Number(limitStr) || 30;
    const offset = Number(offsetStr) || 0;
    return this.feedbackService.getFeedbacks(limit, offset, category, status);
  }

  /**
   * PATCH /api/v1/admin/feedbacks/:id/status
   * 管理员标记内测反馈状态（OPEN / RESOLVED）
   */
  @Patch('admin/feedbacks/:id/status')
  async updateFeedbackStatus(
    @Headers('x-admin-token') token: string | undefined,
    @Param('id') id: string,
    @Body('status') status: string,
  ) {
    this.checkAdminToken(token);
    const updated = await this.feedbackService.updateStatus(id, status);
    return {
      success: true,
      data: updated,
    };
  }
}
