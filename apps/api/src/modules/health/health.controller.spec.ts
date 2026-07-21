import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();
    controller = moduleRef.get(HealthController);
  });

  it('returns ok status with service name', () => {
    const result = controller.check();
    expect(result.status).toBe('ok');
    expect(result.service).toBe('xz-api');
    expect(new Date(result.time).getTime()).not.toBeNaN();
  });
});
