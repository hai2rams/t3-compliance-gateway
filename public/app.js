const SCENARIOS = {
  'finance-safe': {
    useCase: 'finance',
    agentId: 'agent-finance-001',
    userRole: 'analyst',
    actionType: 'internal_summary',
    dataSensitivity: 'LOW',
    toolRequested: 'report_generator',
    purpose: 'Generate internal quarterly summary for finance team',
    content: 'Q1 revenue grew 8% with stable operating margins. No customer PII included.',
    containsPii: false,
    externalSharing: false,
    amount: 0,
  },
  'finance-pii': {
    useCase: 'finance',
    agentId: 'agent-finance-002',
    userRole: 'contractor',
    actionType: 'data_export',
    dataSensitivity: 'HIGH',
    toolRequested: 'email_sender',
    purpose: 'Send customer records to external marketing partner',
    content: 'Export list: john.doe@acme.com, phone 555-123-4567, account 1234567890123456. Confidential client data.',
    containsPii: true,
    externalSharing: true,
    amount: 0,
  },
  'gov-benefit': {
    useCase: 'government',
    agentId: 'agent-gov-001',
    userRole: 'caseworker',
    actionType: 'benefit_eligibility',
    dataSensitivity: 'MEDIUM',
    toolRequested: 'eligibility_engine',
    purpose: 'Determine benefit eligibility for citizen application',
    content: 'Applicant citizen ID 123-45-6789 requests housing benefit. Income verification pending.',
    containsPii: true,
    externalSharing: false,
    amount: 0,
  },
  'procurement-high': {
    useCase: 'procurement',
    agentId: 'agent-proc-001',
    userRole: 'approver',
    actionType: 'payment_approval',
    dataSensitivity: 'HIGH',
    toolRequested: 'payment_gateway',
    purpose: 'Approve vendor payment for infrastructure contract',
    content: 'Approve wire transfer to offshore vendor for server lease. Invoice #INV-99281.',
    containsPii: false,
    externalSharing: false,
    amount: 28500,
  },
};

const FLOW_STEPS = ['agent', 'filter', 'policy', 'router', 'kimi', 't3', 'audit'];

function animateFlow() {
  const steps = document.querySelectorAll('.flow-step');
  steps.forEach((el) => el.classList.remove('active', 'done'));

  let i = 0;
  const interval = setInterval(() => {
    if (i > 0) steps[i - 1].classList.remove('active');
    if (i > 0) steps[i - 1].classList.add('done');
    if (i < steps.length) {
      steps[i].classList.add('active');
      i++;
    } else {
      clearInterval(interval);
    }
  }, 350);
}

function decisionClass(decision) {
  if (decision === 'ALLOW') return 'allow';
  if (decision === 'DENY') return 'deny';
  return 'review';
}

function renderResult(data) {
  document.getElementById('result-panel').hidden = false;

  const decisionEl = document.getElementById('out-decision');
  decisionEl.textContent = data.decision;
  decisionEl.className = `value decision ${decisionClass(data.decision)}`;

  document.getElementById('out-risk').textContent = data.riskScore;
  document.getElementById('out-policy').textContent = data.policyId;
  document.getElementById('out-reasoning').textContent = data.reasoning;

  const sens = data.sensitiveData;
  document.getElementById('out-sensitive').textContent = sens.detected
    ? `Detected: ${sens.types.join(', ')}`
    : 'None detected';
  document.getElementById('out-preview').textContent = sens.redactedPreview;

  document.getElementById('out-route').textContent =
    `${data.route.selectedModel} — ${data.route.routeReason}`;
  document.getElementById('out-kimi').textContent = data.kimi
    ? `${data.kimi.status}: ${data.kimi.summary}`
    : '—';
  document.getElementById('out-trust').textContent =
    `${data.trust.status} (${data.trust.contractMode})`;
  document.getElementById('out-audit-id').textContent = data.auditId;
}

async function loadAuditLog() {
  const res = await fetch('/api/v1/compliance/audit-log');
  const entries = await res.json();
  const tbody = document.getElementById('audit-tbody');

  if (!entries.length) {
    tbody.innerHTML =
      '<tr><td colspan="7" class="empty">No checks yet — run a sample scenario.</td></tr>';
    return;
  }

  tbody.innerHTML = entries
    .map(
      (e) => `
    <tr>
      <td>${new Date(e.timestamp).toLocaleTimeString()}</td>
      <td>${e.request.useCase}</td>
      <td>${e.request.agentId}</td>
      <td class="${decisionClass(e.decision)}">${e.decision}</td>
      <td>${e.riskScore}</td>
      <td>${e.policyId}</td>
      <td>${e.route.selectedModel}</td>
    </tr>`,
    )
    .join('');
}

async function runScenario(key) {
  const payload = SCENARIOS[key];
  if (!payload) return;

  animateFlow();

  const res = await fetch('/api/v1/compliance/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok) {
    alert(data.message || 'Compliance check failed');
    return;
  }

  renderResult(data);
  await loadAuditLog();
}

document.querySelectorAll('[data-scenario]').forEach((btn) => {
  btn.addEventListener('click', () => runScenario(btn.dataset.scenario));
});

loadAuditLog();
