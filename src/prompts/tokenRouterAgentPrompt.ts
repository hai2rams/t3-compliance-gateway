export const TOKEN_ROUTER_AGENT_PROMPT = `Select LLM routing based on modality and policy state:
TEXT -> Kimi
DOCUMENT/IMAGE -> SenseNova + Kimi
VIDEO/AUDIO -> VideoDB + Kimi
WEB_RESEARCH -> Kimi + BrightData (public queries only)
BLOCKED_BY_POLICY -> SKIP_LLM
TokenRouter chooses model provider only — not runtime execution host.`;
