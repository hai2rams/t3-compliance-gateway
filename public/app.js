const SCENARIOS = {
  'claims-pii': {
    workflowType: 'CLAIMS_REVIEW',
    useCase: 'finance',
    agentId: 'claims-review-agent',
    userRole: 'claims_officer',
    actionType: 'CLAIM_DOCUMENT_REVIEW',
    dataSensitivity: 'HIGH',
    toolRequested: 'document_processor',
    purpose: 'Review uploaded claim document',
    content: 'Claim document includes passport, salary slip, and bank statement.',
    containsPii: true,
    externalSharing: false,
    amount: 2500,
    jobMode: 'INTERACTIVE',
    estimatedRecords: 1,
    needsGpu: false,
    needsVideo: false,
    needsWebData: false,
  },
  'bulk-batch': {
    workflowType: 'BULK_BATCH_JOB',
    useCase: 'finance',
    agentId: 'batch-risk-agent',
    userRole: 'risk_analyst',
    actionType: 'BATCH_ANALYSIS',
    dataSensitivity: 'MEDIUM',
    toolRequested: 'batch_anomaly_detector',
    purpose: 'Run anomaly scan on transaction batch',
    content: 'Batch scan of anonymized transaction patterns.',
    containsPii: false,
    externalSharing: false,
    amount: 0,
    jobMode: 'BATCH',
    estimatedRecords: 20000,
    needsGpu: true,
    needsVideo: false,
    needsWebData: false,
  },
  'video-analysis': {
    workflowType: 'VIDEO_ANALYSIS',
    useCase: 'government',
    agentId: 'video-review-agent',
    userRole: 'authorized_officer',
    actionType: 'VIDEO_ANALYSIS',
    dataSensitivity: 'HIGH',
    toolRequested: 'video_analysis',
    purpose: 'Analyze uploaded inspection video securely',
    content: 'Inspection video may contain faces and location details.',
    containsPii: true,
    externalSharing: false,
    amount: 0,
    jobMode: 'STREAMING',
    estimatedRecords: 1,
    needsGpu: false,
    needsVideo: true,
    needsWebData: false,
  },
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

const formStatus = document.getElementById('form-status');
const workflowDropdown = document.getElementById('workflow-type');

function setFormStatus(message) {
  formStatus.textContent = message;
}

function populateForm(payload) {
  const dropdown = workflowDropdown;
  if (payload.workflowType) {
    dropdown.value = payload.workflowType;
  }

  document.getElementById('field-useCase').value = payload.useCase || 'finance';
  document.getElementById('field-dataSensitivity').value = payload.dataSensitivity || 'LOW';
  document.getElementById('field-jobMode').value = payload.jobMode || '';
  document.getElementById('field-agentId').value = payload.agentId || '';
  document.getElementById('field-userRole').value = payload.userRole || '';
  document.getElementById('field-actionType').value = payload.actionType || '';
  document.getElementById('field-toolRequested').value = payload.toolRequested || '';
  document.getElementById('field-purpose').value = payload.purpose || '';
  document.getElementById('field-content').value = payload.content || '';
  document.getElementById('field-amount').value = payload.amount ?? 0;
  document.getElementById('field-estimatedRecords').value =
    payload.estimatedRecords ?? '';

  document.getElementById('field-containsPii').checked = Boolean(payload.containsPii);
  document.getElementById('field-externalSharing').checked = Boolean(payload.externalSharing);
  document.getElementById('field-needsGpu').checked = Boolean(payload.needsGpu);
  document.getElementById('field-needsVideo').checked = Boolean(payload.needsVideo);
  document.getElementById('field-needsWebData').checked = Boolean(payload.needsWebData);
}

function buildPayloadFromForm() {
  const payload = {
    workflowType: workflowDropdown.value,
    useCase: document.getElementById('field-useCase').value,
    agentId: document.getElementById('field-agentId').value.trim(),
    userRole: document.getElementById('field-userRole').value.trim(),
    actionType: document.getElementById('field-actionType').value.trim(),
    dataSensitivity: document.getElementById('field-dataSensitivity').value,
    toolRequested: document.getElementById('field-toolRequested').value.trim(),
    purpose: document.getElementById('field-purpose').value.trim(),
    content: document.getElementById('field-content').value,
    containsPii: document.getElementById('field-containsPii').checked,
    externalSharing: document.getElementById('field-externalSharing').checked,
    amount: Number(document.getElementById('field-amount').value) || 0,
  };

  const jobMode = document.getElementById('field-jobMode').value;
  if (jobMode) payload.jobMode = jobMode;

  const estimatedRecordsRaw = document.getElementById('field-estimatedRecords').value;
  if (estimatedRecordsRaw !== '') {
    payload.estimatedRecords = Number(estimatedRecordsRaw);
  }

  if (document.getElementById('field-needsGpu').checked) payload.needsGpu = true;
  if (document.getElementById('field-needsVideo').checked) payload.needsVideo = true;
  if (document.getElementById('field-needsWebData').checked) payload.needsWebData = true;

  return payload;
}

function loadSample(key) {
  const sample = SCENARIOS[key];
  if (!sample) return;

  populateForm({ ...sample });
  setFormStatus('Sample loaded. Click Run Compliance Check to evaluate.');
}

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
  }, 300);
}

function decisionClass(decision) {
  if (decision === 'ALLOW') return 'allow';
  if (decision === 'DENY') return 'deny';
  return 'review';
}

function renderResult(data) {
  document.getElementById('result-panel').hidden = false;

  document.getElementById('out-workflow').textContent =
    data.workflowLabel || data.workflowType || '—';

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
    `${data.route.selectedLlmProvider} (${data.route.selectedModel}) — ${data.route.routeReason}`;
  document.getElementById('out-llm-provider').textContent = data.llmProvider || '—';
  document.getElementById('out-kimi').textContent = data.kimi
    ? `${data.kimi.status}: ${data.kimi.summary}`
    : '—';
  document.getElementById('out-trust').textContent =
    `${data.trust.status} (${data.trust.contractMode})`;
  document.getElementById('out-audit-id').textContent = data.auditId;

  const runtime = data.runtime || {};
  document.getElementById('out-runtime-provider').textContent = runtime.provider || '—';
  document.getElementById('out-runtime-status').textContent = runtime.status || '—';
  document.getElementById('out-runtime-jobclass').textContent = runtime.jobClass || '—';
  document.getElementById('out-runtime-reason').textContent = runtime.reason || '—';
}

async function loadAuditLog() {
  const res = await fetch('/api/v1/compliance/audit-log');
  const entries = await res.json();
  const tbody = document.getElementById('audit-tbody');

  if (!entries.length) {
    tbody.innerHTML =
      '<tr><td colspan="7" class="empty">No checks yet — run a compliance check.</td></tr>';
    return;
  }

  tbody.innerHTML = entries
    .map(
      (e) => `
    <tr>
      <td>${new Date(e.timestamp).toLocaleTimeString()}</td>
      <td>${e.workflowType || e.request.workflowType || e.request.useCase}</td>
      <td>${e.request.agentId}</td>
      <td class="${decisionClass(e.decision)}">${e.decision}</td>
      <td>${e.riskScore}</td>
      <td>${e.llmProvider || e.route?.selectedLlmProvider || '—'}</td>
      <td>${e.runtime?.provider || 'NONE'} (${e.runtime?.status || '—'})</td>
    </tr>`,
    )
    .join('');
}

async function runComplianceCheck() {
  const payload = buildPayloadFromForm();

  if (!payload.agentId || !payload.userRole || !payload.actionType || !payload.toolRequested) {
    setFormStatus('Please fill required fields: agentId, userRole, actionType, toolRequested.');
    return;
  }

  setFormStatus('Running compliance check…');
  animateFlow();

  const res = await fetch('/api/v1/compliance/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok) {
    setFormStatus(data.message || 'Compliance check failed.');
    alert(data.message || 'Compliance check failed');
    return;
  }

  renderResult(data);
  await loadAuditLog();
  setFormStatus(`Compliance check complete — decision: ${data.decision}.`);
}

document.querySelectorAll('[data-scenario]').forEach((btn) => {
  btn.addEventListener('click', () => loadSample(btn.dataset.scenario));
});

document.getElementById('runComplianceCheck').addEventListener('click', runComplianceCheck);

workflowDropdown.addEventListener('change', () => {
  setFormStatus('Workflow type updated. Click Run Compliance Check to evaluate.');
});

loadSample('claims-pii');
loadAuditLog();
