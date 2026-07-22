import { Module } from '@nestjs/common';
import { HouseholdModule } from '../household/household.module';
import { AgentRuntimeController } from './agent-runtime.controller';
import { AgentRuntimeService } from './agent-runtime.service';
import { AgentToolRegistry } from './agent-tool-registry';
import { AgentToolExecutor } from './agent-tool-executor';
import { ContextBuilder } from './context-builder';
import { FamilyContextService } from './family-context.service';
import { TurnCoordinatorService } from './turn-coordinator.service';

@Module({
  imports: [HouseholdModule],
  controllers: [AgentRuntimeController],
  providers: [
    AgentRuntimeService,
    AgentToolRegistry,
    AgentToolExecutor,
    ContextBuilder,
    FamilyContextService,
    TurnCoordinatorService,
  ],
  exports: [
    AgentRuntimeService,
    AgentToolRegistry,
    AgentToolExecutor,
    ContextBuilder,
    FamilyContextService,
    TurnCoordinatorService,
  ],
})
export class AgentRuntimeModule {}
