/**
 * EventTracer agent (spec §12 Phase 7): a local, offline tool-using assistant.
 * It is an MCP client over apps/mcp and an Ollama client, exposing POST
 * /agent/ask for the UI. No global prefix — routes live under /agent.
 */
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import { AGENT_CONFIG, type AgentConfig } from './app/config/agent-config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  // Open CORS for local dev (UI on :4200 / proxy); tightened with auth later.
  app.enableCors({ origin: true });
  const config = app.get<AgentConfig>(AGENT_CONFIG);
  await app.listen(config.port);
  Logger.log(
    `🤖 Agent up — http://localhost:${config.port}/agent (ask: POST /agent/ask, model: ${config.ollamaModel})`
  );
}

bootstrap();
