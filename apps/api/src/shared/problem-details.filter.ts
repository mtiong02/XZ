import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { DomainError } from '../modules/inventory/domain/errors';

/**
 * 统一 Problem Details 错误结构（docs/03 §2.1）。
 * 错误分类可观察；不向客户端泄漏内部细节（docs/07 §6）。
 */

const KIND_TO_STATUS: Record<DomainError['kind'], number> = {
  VALIDATION: HttpStatus.BAD_REQUEST,
  AUTHORIZATION: HttpStatus.FORBIDDEN,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  CONFLICT: HttpStatus.CONFLICT,
};

function toKebab(code: string): string {
  return code.toLowerCase().replace(/_/g, '-');
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const traceId = (request.headers['x-request-id'] as string | undefined) ?? randomUUID();

    if (exception instanceof DomainError) {
      const status = KIND_TO_STATUS[exception.kind];
      response.status(status).json({
        type: `https://xz.app/errors/${toKebab(exception.code)}`,
        title: exception.message,
        status,
        code: exception.code,
        detail: exception.message,
        trace_id: traceId,
        fields: exception.details ?? {},
      });
      return;
    }

    if (exception instanceof ZodError) {
      response.status(HttpStatus.BAD_REQUEST).json({
        type: 'https://xz.app/errors/validation-failed',
        title: 'Validation failed',
        status: 400,
        code: 'VALIDATION_FAILED',
        detail: 'Request payload failed schema validation.',
        trace_id: traceId,
        fields: exception.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      response.status(status).json({
        type: 'https://xz.app/errors/http',
        title: exception.message,
        status,
        code: 'HTTP_ERROR',
        detail: exception.message,
        trace_id: traceId,
        fields: {},
      });
      return;
    }

    this.logger.error(
      JSON.stringify({ msg: 'unhandled_exception', trace_id: traceId, error: String(exception) }),
    );
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      type: 'https://xz.app/errors/internal',
      title: 'Internal server error',
      status: 500,
      code: 'INTERNAL',
      detail: 'An unexpected error occurred.',
      trace_id: traceId,
      fields: {},
    });
  }
}
