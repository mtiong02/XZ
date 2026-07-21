import {
  Body,
  Controller,
  Delete,
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
  NotificationActionSchema,
  NotificationService,
  ReminderPreferencesSchema,
} from './notification.service';

@Controller('households/:householdId/notifications')
@UseGuards(AuthGuard)
export class NotificationController {
  constructor(@Inject(NotificationService) private readonly notifications: NotificationService) {}
  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('householdId', ParseUUIDPipe) householdId: string,
  ) {
    return this.notifications.syncAndList(householdId, user.userId);
  }
  @Post(':notificationId/action')
  act(
    @CurrentUser() user: AuthenticatedUser,
    @Param('householdId', ParseUUIDPipe) householdId: string,
    @Param('notificationId', ParseUUIDPipe) notificationId: string,
    @Body() body: unknown,
  ) {
    return this.notifications.act(
      householdId,
      notificationId,
      user.userId,
      NotificationActionSchema.parse(body),
    );
  }
  @Get('reminders') reminders(
    @CurrentUser() user: AuthenticatedUser,
    @Param('householdId', ParseUUIDPipe) householdId: string,
  ) {
    return this.notifications.listReminderTasks(householdId, user.userId);
  }
  @Delete('reminders/:reminderId') cancelReminder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('householdId', ParseUUIDPipe) householdId: string,
    @Param('reminderId', ParseUUIDPipe) reminderId: string,
  ) {
    return this.notifications.cancelReminder(householdId, reminderId, user.userId);
  }
  @Get('preferences') preferences(
    @CurrentUser() user: AuthenticatedUser,
    @Param('householdId', ParseUUIDPipe) householdId: string,
  ) {
    return this.notifications.getPreferences(householdId, user.userId);
  }
  @Post('preferences') updatePreferences(
    @CurrentUser() user: AuthenticatedUser,
    @Param('householdId', ParseUUIDPipe) householdId: string,
    @Body() body: unknown,
  ) {
    return this.notifications.updatePreferences(
      householdId,
      user.userId,
      ReminderPreferencesSchema.parse(body),
    );
  }
  @Get('daily-briefing') briefing(
    @CurrentUser() user: AuthenticatedUser,
    @Param('householdId', ParseUUIDPipe) householdId: string,
  ) {
    return this.notifications.dailyBriefing(householdId, user.userId);
  }
}
