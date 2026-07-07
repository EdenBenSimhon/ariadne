import { Module } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { AGENT_CONFIG, loadAgentConfig } from './config/agent-config';
import { McpClientService } from './mcp-client.service';
import { OllamaService } from './ollama.service';

@Module({
  controllers: [AgentController],
  providers: [
    { provide: AGENT_CONFIG, useFactory: () => loadAgentConfig() },
    McpClientService,
    OllamaService,
    AgentService,
  ],
})
export class AppModule {}
