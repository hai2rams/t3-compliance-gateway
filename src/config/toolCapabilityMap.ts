export type ToolName =
  | 'Terminal 3'
  | 'TokenRouter'
  | 'Kimi'
  | 'SenseNova'
  | 'BrightData/MCP'
  | 'Daytona'
  | 'Nosana'
  | 'VideoDB';

export type ToolRole =
  | 'identity_governance_audit'
  | 'model_routing_cost_boundary'
  | 'reasoning_summary_judge'
  | 'document_image_multimodal_reasoning'
  | 'public_web_enrichment'
  | 'docker_sandbox_execution'
  | 'gpu_batch_execution'
  | 'video_audio_workflow';

export type ToolChainStatus = 'USED' | 'MOCKED' | 'PLANNED' | 'BLOCKED' | 'SKIPPED';

export type ToolCapability = {
  tool: ToolName;
  role: ToolRole;
  envKey?: string;
};

export const TOOL_ORCHESTRATION_STRATEGY = 'GOVERNED_AUTONOMOUS_TOOL_CHAIN' as const;

export const TOOL_CAPABILITY_MAP: ToolCapability[] = [
  { tool: 'Terminal 3', role: 'identity_governance_audit', envKey: 'T3N_API_KEY' },
  { tool: 'TokenRouter', role: 'model_routing_cost_boundary' },
  { tool: 'Kimi', role: 'reasoning_summary_judge', envKey: 'KIMI_API_KEY' },
  { tool: 'SenseNova', role: 'document_image_multimodal_reasoning', envKey: 'SENSENOVA_API_KEY' },
  { tool: 'BrightData/MCP', role: 'public_web_enrichment', envKey: 'BRIGHTDATA_API_KEY' },
  { tool: 'Daytona', role: 'docker_sandbox_execution', envKey: 'DAYTONA_API_KEY' },
  { tool: 'Nosana', role: 'gpu_batch_execution', envKey: 'NOSANA_API_KEY' },
  { tool: 'VideoDB', role: 'video_audio_workflow', envKey: 'VIDEODB_API_KEY' },
];

export function isGlobalMockMode(): boolean {
  return process.env.MOCK_MODE === 'true';
}

export function isAdapterMocked(envKey?: string): boolean {
  if (isGlobalMockMode()) return true;
  if (!envKey) return false;
  return !process.env[envKey]?.trim();
}

export function liveOrMocked(live: boolean): 'USED' | 'MOCKED' {
  return live ? 'USED' : 'MOCKED';
}
