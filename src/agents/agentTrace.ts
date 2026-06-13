export type AgentTraceStep = {
  step: number;
  agent: string;
  action: string;
  status: 'COMPLETED' | 'BLOCKED' | 'SKIPPED' | 'HOLD';
  summary: string;
};

export class AgentTraceBuilder {
  private steps: AgentTraceStep[] = [];
  private counter = 0;

  add(
    agent: string,
    action: string,
    status: AgentTraceStep['status'],
    summary: string,
  ): void {
    this.counter += 1;
    this.steps.push({ step: this.counter, agent, action, status, summary });
  }

  build(): AgentTraceStep[] {
    return [...this.steps];
  }
}

export function detectPromptInjection(content: string): boolean {
  return /\b(ignore\s+(all\s+)?previous\s+instructions|disable\s+(policy|governance)|override\s+policy|bypass\s+compliance|ignore\s+safety)\b/i.test(
    content,
  );
}
