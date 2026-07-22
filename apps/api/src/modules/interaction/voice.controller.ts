import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, type AuthenticatedUser } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import {
  ConfirmVoiceJobSchema,
  CreateTextVoiceJobSchema,
  MealFeedbackSchema,
  ReplyVoiceJobSchema,
  VoiceService,
} from './voice.service';

/**
 * Voice API（docs/03 §5）。
 * MVP 提供文本通道（Web Speech / 手动输入）；音频上传通道待真实 ASR Provider
 * 配置后启用（Adapter 接口已就绪，见 asr/asr-provider.ts）。
 */
@Controller('voice-jobs')
@UseGuards(AuthGuard)
export class VoiceController {
  constructor(@Inject(VoiceService) private readonly voice: VoiceService) {}

  @Post()
  async create(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    const input = CreateTextVoiceJobSchema.parse(body);
    return this.voice.createTextJob(user.userId, input);
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.voice.getJob(id, user.userId);
  }

  @Post(':id/confirm')
  async confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.voice.confirm(id, user.userId, ConfirmVoiceJobSchema.parse(body ?? {}));
  }

  /** 多轮语音对话推进：用户对系统播报的口头回应（"对"/"不对"/"改成三盒"）。 */
  @Post(':id/reply')
  async reply(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.voice.reply(id, user.userId, ReplyVoiceJobSchema.parse(body));
  }

  @Post(':id/cancel')
  async cancel(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.voice.cancel(id, user.userId);
  }

  @Post(':id/meal-feedback')
  async mealFeedback(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.voice.recordMealFeedback(id, user.userId, MealFeedbackSchema.parse(body));
  }
}
