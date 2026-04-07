export function renderDashboardTestPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SGP Datacenter - Dashboard Test</title>
  <style>
    :root {
      --bg: #0b1220;
      --panel: #111a2b;
      --line: #22324f;
      --line-strong: #2c4268;
      --text: #e6efff;
      --muted: #9fb3d4;
      --ok: #49d48c;
      --warn: #ffb463;
      --danger: #ff6a7a;
      --accent: #7cb7ff;
      --chip: #0c1524;
    }
    * { box-sizing: border-box; }
    html { color-scheme: dark; }
    body {
      margin: 0;
      background:
        radial-gradient(circle at 20% -20%, rgba(122, 175, 255, 0.20), transparent 38%),
        radial-gradient(circle at 100% 0%, rgba(73, 212, 140, 0.10), transparent 25%),
        linear-gradient(180deg, #090f1b, #0b1220 45%, #0a1020 100%);
      color: var(--text);
      font-family: "IBM Plex Sans", "Segoe UI", system-ui, sans-serif;
      font-size: 14px;
    }
    .shell {
      max-width: 1280px;
      margin: 0 auto;
      padding: 14px;
      display: grid;
      gap: 10px;
    }
    .panel {
      border: 1px solid var(--line);
      background: linear-gradient(180deg, rgba(19, 31, 51, 0.96), rgba(14, 23, 39, 0.96));
      border-radius: 12px;
      padding: 10px;
      box-shadow: 0 14px 30px rgba(0, 0, 0, 0.20);
    }
    .row {
      display: grid;
      gap: 10px;
      grid-template-columns: repeat(12, minmax(0, 1fr));
    }
    .span-3 { grid-column: span 3; }
    .span-4 { grid-column: span 4; }
    .span-6 { grid-column: span 6; }
    .span-7 { grid-column: span 7; }
    .span-8 { grid-column: span 8; }
    .span-5 { grid-column: span 5; }
    .span-12 { grid-column: span 12; }
    h1 {
      margin: 0;
      font-size: 18px;
      letter-spacing: -0.01em;
    }
    h2 {
      margin: 0 0 8px;
      font-size: 13px;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 5px 10px;
      font-size: 12px;
      color: var(--muted);
      background: rgba(12, 21, 36, 0.9);
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--warn);
      box-shadow: 0 0 0 3px rgba(255, 180, 99, 0.12);
    }
    .dot.ok {
      background: var(--ok);
      box-shadow: 0 0 0 3px rgba(73, 212, 140, 0.12);
    }
    .dot.warn {
      background: var(--warn);
      box-shadow: 0 0 0 3px rgba(255, 180, 99, 0.12);
    }
    .dot.danger {
      background: var(--danger);
      box-shadow: 0 0 0 3px rgba(255, 106, 122, 0.12);
    }
    .kv {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 6px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--chip);
      padding: 7px 8px;
      font-size: 12px;
    }
    .kv span { color: var(--muted); }
    .stack { display: grid; gap: 7px; }
    .grid { display: grid; gap: 8px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .cards { display: grid; gap: 8px; }
    .card {
      border: 1px solid var(--line);
      border-radius: 10px;
      background: var(--chip);
      padding: 9px;
      display: grid;
      gap: 6px;
    }
    .card-head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 8px;
    }
    .card-title {
      display: grid;
      gap: 2px;
      min-width: 0;
    }
    .card-title strong {
      font-size: 13px;
      line-height: 1.25;
      word-break: break-word;
    }
    .card-title span,
    .card-meta,
    .muted {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.35;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      border-radius: 999px;
      padding: 3px 8px;
      font-size: 11px;
      border: 1px solid var(--line);
      color: var(--muted);
      background: rgba(255, 255, 255, 0.02);
      white-space: nowrap;
      flex: 0 0 auto;
    }
    .badge.ok {
      color: var(--ok);
      border-color: rgba(73, 212, 140, 0.28);
      background: rgba(73, 212, 140, 0.08);
    }
    .badge.warn {
      color: var(--warn);
      border-color: rgba(255, 180, 99, 0.28);
      background: rgba(255, 180, 99, 0.08);
    }
    .badge.danger {
      color: var(--danger);
      border-color: rgba(255, 106, 122, 0.28);
      background: rgba(255, 106, 122, 0.08);
    }
    .badge.neutral {
      color: var(--accent);
      border-color: rgba(124, 183, 255, 0.24);
      background: rgba(124, 183, 255, 0.08);
    }
    .banner {
      border: 1px solid rgba(255, 180, 99, 0.28);
      background: rgba(255, 180, 99, 0.08);
      color: #ffd9ab;
      border-radius: 10px;
      padding: 8px 10px;
      font-size: 12px;
      line-height: 1.45;
      display: none;
      margin-top: 10px;
    }
    .banner.show {
      display: block;
    }
    .banner.danger {
      border-color: rgba(255, 106, 122, 0.32);
      background: rgba(255, 106, 122, 0.08);
      color: #ffc0c7;
    }
    .metrics {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .metric {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 3px 8px;
      font-size: 11px;
      color: var(--muted);
      background: rgba(255, 255, 255, 0.02);
    }
    .metric strong { color: var(--text); font-weight: 700; }
    .split {
      display: grid;
      gap: 8px;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .field {
      display: grid;
      gap: 5px;
      min-width: 0;
    }
    .field-label {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.2;
    }
    .field-help {
      color: var(--muted);
      font-size: 11px;
      line-height: 1.4;
    }
    .auth-state {
      display: grid;
      gap: 6px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: rgba(12, 21, 36, 0.8);
      padding: 8px;
    }
    .auth-state .kv {
      padding: 6px 8px;
    }
    .auth-state .kv strong {
      text-align: right;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    input, select, button {
      width: 100%;
      min-height: 34px;
      border-radius: 8px;
      font-size: 13px;
    }
    input, select {
      border: 1px solid var(--line);
      color: var(--text);
      background: #0c1524;
      padding: 7px 9px;
    }
    input::placeholder { color: #6f86aa; }
    button {
      border: 0;
      font-weight: 700;
      cursor: pointer;
      color: #06111f;
      background: linear-gradient(135deg, #97d2ff, #82a9ff);
      box-shadow: 0 10px 20px rgba(130, 169, 255, 0.15);
    }
    button.secondary {
      color: var(--text);
      background: linear-gradient(135deg, #1a2940, #152135);
      border: 1px solid var(--line);
      box-shadow: none;
    }
    button:disabled {
      cursor: not-allowed;
      opacity: 0.65;
    }
    pre {
      margin: 0;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #0a1220;
      color: #cfe0ff;
      padding: 8px;
      overflow: auto;
      max-height: 340px;
      font-size: 12px;
      line-height: 1.38;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .empty {
      border: 1px dashed var(--line-strong);
      border-radius: 10px;
      padding: 12px;
      color: var(--muted);
      background: rgba(12, 21, 36, 0.5);
      font-size: 12px;
    }
    .row-head {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: center;
      margin-bottom: 8px;
    }
    .section-note {
      color: var(--muted);
      font-size: 12px;
      margin: 0;
    }
    .scroll-log {
      max-height: 360px;
      overflow: auto;
    }
    @media (max-width: 1024px) {
      .span-3, .span-4, .span-5, .span-6, .span-7, .span-8, .span-12 { grid-column: 1 / -1; }
    }
    @media (max-width: 760px) {
      .grid, .split { grid-template-columns: 1fr; }
      .row-head { align-items: flex-start; flex-direction: column; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <div class="panel">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
        <h1>Datacenter Dashboard Test Tool</h1>
        <div class="status"><i id="statusDot" class="dot warn"></i><span id="statusText">Disconnected</span></div>
      </div>
      <div id="authBanner" class="banner" aria-live="polite"></div>
    </div>

    <div class="row">
      <div class="panel span-3">
        <h2>Connection</h2>
        <div class="stack">
          <div class="kv"><span>Server</span><strong id="serverUrl">-</strong></div>
          <div class="kv"><span>Socket ID</span><strong id="socketId">-</strong></div>
          <div class="kv"><span>Connected Devices</span><strong id="deviceCount">-</strong></div>
          <div class="kv"><span>Alert Socket</span><strong id="alertSocketState">Idle</strong></div>
        </div>
      </div>

      <div class="panel span-4">
        <h2>Auth</h2>
        <div class="stack">
          <div class="split">
            <label class="field">
              <span class="field-label">Local role</span>
              <select id="authRole">
                <option value="viewer">viewer</option>
                <option value="operator">operator</option>
                <option value="admin">admin</option>
              </select>
            </label>
            <label class="field">
              <span class="field-label">Token</span>
              <input id="authToken" type="password" placeholder="Paste bearer token (optional)" autocomplete="off" />
            </label>
          </div>
          <div class="split">
            <button id="applyAuthBtn" type="button">Apply Auth</button>
            <button id="clearAuthBtn" type="button" class="secondary">Clear Token</button>
          </div>
          <div class="auth-state" id="authState">
            <div class="kv"><span>Selected role</span><strong id="authRoleLabel">viewer</strong></div>
            <div class="kv"><span>Token</span><strong id="authTokenLabel">none</strong></div>
            <div class="kv"><span>Request headers</span><strong id="authHeaderLabel">X-Dashboard-Role</strong></div>
          </div>
          <p class="section-note">Role is a local UI gate. Token is attached as <code>Authorization: Bearer ...</code> when present.</p>
        </div>
      </div>

      <div class="panel span-5">
        <div class="row-head">
          <div>
            <h2>Send Command</h2>
            <p class="section-note">Operator or admin only. Requests include the selected role and token headers.</p>
          </div>
          <div class="badge neutral" id="commandAccessBadge">operator+</div>
        </div>
        <div class="grid">
          <input id="deviceId" type="text" placeholder="Device ID (e.g. esp-001)" />
          <select id="commandType">
            <option value="capture">capture</option>
            <option value="calibrate">calibrate</option>
            <option value="restart">restart</option>
            <option value="set_config">set_config</option>
          </select>
          <input id="payloadJson" type="text" placeholder='Payload JSON (e.g. {"sampleRate":100})' />
          <button id="sendCmdBtn" type="button">Send Command</button>
        </div>
        <p class="muted" id="commandStatus">Ready</p>
      </div>
    </div>

    <div class="row">
      <div class="panel span-4">
        <h2>Devices</h2>
        <pre id="deviceList">Loading...</pre>
      </div>

      <div class="panel span-8">
        <h2>Live Telemetry</h2>
        <pre id="telemetryLog">Waiting for telemetry...</pre>
      </div>
    </div>

    <div class="row">
      <div class="panel span-4">
        <div class="row-head">
          <div>
            <h2>Ops Health</h2>
            <p class="section-note">Combined view from <code>/health</code> and <code>/health/ready</code>.</p>
          </div>
          <button id="refreshOpsBtn" type="button" class="secondary">Refresh Ops</button>
        </div>
        <pre id="healthSnapshot">Loading health snapshots...</pre>
      </div>

      <div class="panel span-4">
        <div class="row-head">
          <div>
            <h2>Metrics Snapshot</h2>
            <p class="section-note">JSON snapshot from <code>/api/ops/metrics</code> for operator backend triage.</p>
          </div>
        </div>
        <pre id="metricsSnapshot">Loading metrics...</pre>
      </div>

      <div class="panel span-4">
        <div class="row-head">
          <div>
            <h2>Telemetry Inspect</h2>
            <p class="section-note">Inspect retained telemetry history by device and optional bucket window.</p>
          </div>
        </div>
        <div class="grid" style="margin-bottom:8px;">
          <input id="telemetryHistoryDeviceId" type="text" placeholder="Device ID (e.g. esp-001)" value="esp-001" />
          <input id="telemetryHistoryLimit" type="number" min="1" max="200" value="20" placeholder="Limit" />
          <input id="telemetryHistoryBucketMs" type="number" min="0" placeholder="Bucket ms (optional)" value="1000" />
          <button id="refreshTelemetryHistoryBtn" type="button" class="secondary">Refresh History</button>
        </div>
        <pre id="telemetryHistorySnapshot">Waiting for telemetry history query...</pre>
      </div>
    </div>

    <div class="row">
      <div class="panel span-4">
        <div class="row-head">
          <div>
            <h2>Alert Rules</h2>
            <p class="section-note">Rules fetched from the alerting API, if present. Admin only to create or update.</p>
          </div>
          <div class="badge neutral" id="ruleAccessBadge">admin only</div>
          <div class="badge neutral" id="alertRuleCount">0 rules</div>
        </div>
        <div class="grid" style="margin-bottom:8px;">
          <input id="ruleIdInput" type="text" placeholder="Rule ID for update (optional)" />
          <input id="ruleNameInput" type="text" placeholder="Rule name" />
          <select id="ruleMetricInput">
            <option value="temperature">temperature</option>
            <option value="vibration">vibration</option>
          </select>
          <select id="ruleSeverityInput">
            <option value="warning">warning</option>
            <option value="critical">critical</option>
          </select>
          <input id="ruleThresholdInput" type="number" step="0.01" placeholder="Threshold" />
          <input id="ruleDebounceInput" type="number" min="1" placeholder="Debounce count" />
          <input id="ruleCooldownInput" type="number" min="0" placeholder="Cooldown ms" />
          <select id="ruleEnabledInput">
            <option value="true">enabled</option>
            <option value="false">disabled</option>
          </select>
        </div>
        <div class="split" style="margin-bottom:8px;">
          <button id="saveRuleBtn" type="button" class="secondary">Create / Update Rule</button>
          <div class="muted" id="ruleEditorStatus">Rule editor ready</div>
        </div>
        <div id="alertRulesList" class="cards">
          <div class="empty">Loading alert rules...</div>
        </div>
      </div>

      <div class="panel span-4">
        <div class="row-head">
          <div>
            <h2>Active Alerts</h2>
            <p class="section-note">Current open alerts plus live socket updates.</p>
          </div>
          <div class="badge danger" id="activeAlertCount">0 active</div>
        </div>
        <div id="activeAlertsList" class="cards">
          <div class="empty">Loading active alerts...</div>
        </div>
      </div>

      <div class="panel span-4">
        <div class="row-head">
          <div>
            <h2>Alert History</h2>
            <p class="section-note">Resolved or historical alerts if the backend exposes them.</p>
          </div>
          <div class="badge neutral" id="historyAlertCount">0 history</div>
        </div>
        <div id="historyAlertsList" class="cards">
          <div class="empty">Loading alert history...</div>
        </div>
      </div>
    </div>

    <div class="row">
      <div class="panel span-5">
        <div class="row-head">
          <div>
            <h2>Alert Workflow</h2>
            <p class="section-note">Operator controls for alert acknowledge and resolve. Use an alert ID directly or load the first active alert.</p>
          </div>
        </div>
        <div class="grid" style="margin-bottom:8px;">
          <input id="alertWorkflowAlertId" type="text" placeholder="Alert ID (e.g. alert-123)" />
          <input id="alertAckNote" type="text" placeholder="Ack note (optional)" />
          <input id="alertResolveNote" type="text" placeholder="Resolve note (optional)" />
          <button id="alertUseFirstBtn" type="button" class="secondary">Use first active alert</button>
          <button id="alertAckBtn" type="button">Ack Alert</button>
          <button id="alertResolveBtn" type="button" class="secondary">Resolve Alert</button>
        </div>
        <p class="muted" id="alertWorkflowStatus">Alert workflow idle</p>
      </div>

      <div class="panel span-7">
        <div class="row-head">
          <div>
            <h2>Incident Workspace</h2>
            <p class="section-note">Create, assign, update and close incidents from active alerts without leaving the ops console.</p>
          </div>
          <div class="badge neutral" id="incidentCount">0 incidents</div>
        </div>
        <div class="grid" style="margin-bottom:8px;">
          <input id="incidentSourceAlertId" type="text" placeholder="Source alert ID" />
          <input id="incidentIdInput" type="text" placeholder="Incident ID (for update)" />
          <input id="incidentTitleInput" type="text" placeholder="Incident title" />
          <select id="incidentSeverityInput">
            <option value="warning">warning</option>
            <option value="critical">critical</option>
          </select>
          <input id="incidentOwnerInput" type="text" placeholder="Owner / assignee" />
          <input id="incidentSiteInput" type="text" placeholder="Site (optional)" />
          <input id="incidentNoteInput" type="text" placeholder="Timeline note / resolution note" />
          <select id="incidentStatusFilter">
            <option value="">all statuses</option>
            <option value="open">open</option>
            <option value="assigned">assigned</option>
            <option value="monitoring">monitoring</option>
            <option value="resolved">resolved</option>
            <option value="closed">closed</option>
          </select>
        </div>
        <div class="grid" style="margin-bottom:8px;">
          <select id="incidentSeverityFilter">
            <option value="">all severities</option>
            <option value="warning">warning</option>
            <option value="critical">critical</option>
          </select>
          <input id="incidentOwnerFilter" type="text" placeholder="Filter by owner" />
          <input id="incidentSiteFilter" type="text" placeholder="Filter by site" />
          <input id="incidentFromFilter" type="datetime-local" />
          <input id="incidentToFilter" type="datetime-local" />
          <div class="muted">History filters apply to updated time.</div>
        </div>
        <div class="split" style="margin-bottom:8px;">
          <button id="refreshIncidentsBtn" type="button" class="secondary">Refresh Incidents</button>
          <button id="incidentUseAlertBtn" type="button" class="secondary">Use alert ID</button>
        </div>
        <div class="split" style="margin-bottom:8px;">
          <button id="createIncidentBtn" type="button">Create Incident</button>
          <button id="assignIncidentBtn" type="button" class="secondary">Assign Owner</button>
        </div>
        <div class="split" style="margin-bottom:8px;">
          <button id="incidentNoteBtn" type="button" class="secondary">Add Note</button>
          <button id="resolveIncidentBtn" type="button" class="secondary">Resolve Incident</button>
        </div>
        <div class="split" style="margin-bottom:8px;">
          <button id="closeIncidentBtn" type="button" class="secondary">Close Incident</button>
          <div class="muted" id="incidentWorkflowStatus">Incident workflow idle</div>
        </div>
        <div id="incidentList" class="cards">
          <div class="empty">No incidents loaded yet.</div>
        </div>
      </div>
    </div>

    <div class="row">
      <div class="panel span-4">
        <div class="row-head">
          <div>
            <h2>Alert Noise Summary</h2>
            <p class="section-note">Coalesced, suppressed, and flapping counts from <code>/api/alerts/summary</code>.</p>
          </div>
          <button id="refreshAlertSummaryBtn" type="button" class="secondary">Refresh Alert Summary</button>
        </div>
        <div class="metrics" id="alertSummaryMetrics">
          <div class="metric">Records <strong id="alertSummaryTotal">0</strong></div>
          <div class="metric">Suppressed <strong id="alertSummarySuppressed">0</strong></div>
          <div class="metric">Coalesced <strong id="alertSummaryCoalesced">0</strong></div>
          <div class="metric">Flapping <strong id="alertSummaryFlapping">0</strong></div>
        </div>
        <div id="alertSummaryList" class="cards">
          <div class="empty">Loading alert summary...</div>
        </div>
      </div>

      <div class="panel span-4">
        <div class="row-head">
          <div>
            <h2>Incident Summary</h2>
            <p class="section-note">Aggregated view from <code>/api/incidents/summary</code> for handover and review.</p>
          </div>
          <button id="refreshIncidentSummaryBtn" type="button" class="secondary">Refresh Summary</button>
        </div>
        <div class="metrics" id="incidentSummaryMetrics">
          <div class="metric">Total <strong id="incidentSummaryTotal">0</strong></div>
          <div class="metric">Open <strong id="incidentSummaryOpen">0</strong></div>
          <div class="metric">Assigned <strong id="incidentSummaryAssigned">0</strong></div>
          <div class="metric">Closed <strong id="incidentSummaryClosed">0</strong></div>
        </div>
        <div id="incidentSummaryList" class="cards">
          <div class="empty">Loading incident summary...</div>
        </div>
      </div>

      <div class="panel span-4">
        <div class="row-head">
          <div>
            <h2>Incident Timeline</h2>
            <p class="section-note">Load an incident to inspect timeline entries and handover context.</p>
          </div>
          <button id="refreshIncidentTimelineBtn" type="button" class="secondary">Refresh Timeline</button>
        </div>
        <div class="metrics" style="margin-bottom:8px;">
          <div class="metric">Selected <strong id="incidentTimelineTarget">none</strong></div>
          <div class="metric">Entries <strong id="incidentTimelineCount">0</strong></div>
        </div>
        <div id="incidentTimelineList" class="cards">
          <div class="empty">Load an incident to inspect its timeline.</div>
        </div>
      </div>
    </div>

    <div class="row">
      <div class="panel span-12">
        <div class="row-head">
          <div>
            <h2>Shift Handover</h2>
            <p class="section-note">Admin export + snapshot bundle for shift handover using current incident filters.</p>
          </div>
          <div class="badge neutral" id="handoverAccessBadge">admin only</div>
        </div>
        <div class="grid" style="margin-bottom:8px;">
          <select id="handoverExportFormat">
            <option value="json">json</option>
            <option value="ndjson">ndjson</option>
          </select>
          <input id="handoverExportLimit" type="number" min="1" max="1000" value="100" placeholder="Export limit" />
          <button id="runHandoverBtn" type="button" class="secondary">Generate Handover Snapshot</button>
          <div class="muted" id="handoverStatus">Handover snapshot idle</div>
        </div>
        <pre id="handoverSnapshot">No handover snapshot generated yet.</pre>
      </div>
    </div>

    <div class="row">
      <div class="panel span-4">
        <div class="row-head">
          <div>
            <h2>Fleet Cohorts</h2>
            <p class="section-note">Create and store local cohort presets for fleet operations.</p>
          </div>
        </div>
        <div class="grid" style="margin-bottom:8px;">
          <input id="fleetGroupName" type="text" placeholder="Cohort name (e.g. sgp-zone-a-online)" />
          <input id="fleetSiteFilter" type="text" placeholder="Site filter (optional)" />
          <input id="fleetZoneFilter" type="text" placeholder="Zone filter (optional)" />
          <select id="fleetStatusFilter">
            <option value="">all status</option>
            <option value="online">online</option>
            <option value="offline">offline</option>
          </select>
          <input id="fleetSearchFilter" type="text" placeholder="Search (device/name/fw...)" />
          <button id="fleetSaveGroupBtn" type="button" class="secondary">Save Cohort Preset</button>
        </div>
        <div class="metrics" style="margin-bottom:8px;">
          <div class="metric">Saved presets <strong id="fleetGroupCount">0</strong></div>
          <div class="metric">Matched devices <strong id="fleetPreviewCount">0</strong></div>
        </div>
        <div id="fleetGroupList" class="cards">
          <div class="empty">No cohort presets yet.</div>
        </div>
      </div>

      <div class="panel span-8">
        <div class="row-head">
          <div>
            <h2>Fleet Batch Config</h2>
            <p class="section-note">Preview target devices, dry-run impact, then dispatch <code>set_config</code> in controlled batches.</p>
          </div>
          <div class="badge neutral" id="fleetAccessBadge">operator+</div>
        </div>
        <div class="grid" style="margin-bottom:8px;">
          <input id="fleetConfigJson" type="text" placeholder='Config JSON (e.g. {"sampleRate":100,"fftWindow":512})' />
          <button id="fleetPreviewBtn" type="button" class="secondary">Preview Cohort</button>
          <button id="fleetDryRunBtn" type="button" class="secondary">Dry-Run Batch</button>
          <button id="fleetApplyBtn" type="button">Apply set_config</button>
        </div>
        <div class="metrics" style="margin-bottom:8px;">
          <div class="metric">Dispatched <strong id="fleetBatchTotal">0</strong></div>
          <div class="metric">Accepted <strong id="fleetBatchSuccess">0</strong></div>
          <div class="metric">Failed <strong id="fleetBatchFailed">0</strong></div>
        </div>
        <p class="muted" id="fleetBatchStatus">Fleet batch idle</p>
        <div id="fleetPreviewList" class="cards">
          <div class="empty">Run preview to inspect matched devices.</div>
        </div>
      </div>
    </div>

    <div class="row">
      <div class="panel span-12">
        <div class="row-head">
          <div>
            <h2>Live Alert Stream</h2>
            <p class="section-note">Socket event <code>alert</code> entries are appended here when available.</p>
          </div>
          <div class="metrics">
            <div class="metric">Received <strong id="alertStreamCount">0</strong></div>
            <div class="metric">Source <strong id="alertStreamSource">socket</strong></div>
          </div>
        </div>
        <pre id="alertStreamLog" class="scroll-log">Waiting for alert stream...</pre>
      </div>
    </div>

    <div class="row">
      <div class="panel span-12">
        <div class="row-head">
          <div>
            <h2>Audit Logs</h2>
            <p class="section-note">Optional readout from <code>/api/audit-logs</code> with device, command, and limit filters.</p>
          </div>
          <div class="badge neutral" id="auditLogCount">0 logs</div>
        </div>
        <div class="grid" style="margin-bottom:8px;">
          <input id="auditDeviceId" type="text" placeholder="Filter by deviceId" />
          <input id="auditCommandId" type="text" placeholder="Filter by commandId" />
          <input id="auditLimit" type="number" min="1" max="200" value="25" placeholder="Limit" />
          <button id="refreshAuditLogsBtn" type="button" class="secondary">Refresh Logs</button>
        </div>
        <div id="auditLogList" class="cards">
          <div class="empty">Loading audit logs...</div>
        </div>
      </div>
    </div>
  </div>

  <script src="/socket.io/socket.io.js"></script>
  <script>
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    const authBanner = document.getElementById('authBanner');
    const socketIdEl = document.getElementById('socketId');
    const serverUrlEl = document.getElementById('serverUrl');
    const telemetryLog = document.getElementById('telemetryLog');
    const deviceList = document.getElementById('deviceList');
    const deviceCount = document.getElementById('deviceCount');
    const healthSnapshot = document.getElementById('healthSnapshot');
    const metricsSnapshot = document.getElementById('metricsSnapshot');
    const refreshOpsBtn = document.getElementById('refreshOpsBtn');
    const telemetryHistoryDeviceId = document.getElementById('telemetryHistoryDeviceId');
    const telemetryHistoryLimit = document.getElementById('telemetryHistoryLimit');
    const telemetryHistoryBucketMs = document.getElementById('telemetryHistoryBucketMs');
    const refreshTelemetryHistoryBtn = document.getElementById('refreshTelemetryHistoryBtn');
    const telemetryHistorySnapshot = document.getElementById('telemetryHistorySnapshot');
    const authRole = document.getElementById('authRole');
    const authToken = document.getElementById('authToken');
    const applyAuthBtn = document.getElementById('applyAuthBtn');
    const clearAuthBtn = document.getElementById('clearAuthBtn');
    const authRoleLabel = document.getElementById('authRoleLabel');
    const authTokenLabel = document.getElementById('authTokenLabel');
    const authHeaderLabel = document.getElementById('authHeaderLabel');
    const commandStatus = document.getElementById('commandStatus');
    const sendCmdBtn = document.getElementById('sendCmdBtn');
    const alertRulesList = document.getElementById('alertRulesList');
    const activeAlertsList = document.getElementById('activeAlertsList');
    const historyAlertsList = document.getElementById('historyAlertsList');
    const alertRuleCount = document.getElementById('alertRuleCount');
    const ruleAccessBadge = document.getElementById('ruleAccessBadge');
    const commandAccessBadge = document.getElementById('commandAccessBadge');
    const ruleIdInput = document.getElementById('ruleIdInput');
    const ruleNameInput = document.getElementById('ruleNameInput');
    const ruleMetricInput = document.getElementById('ruleMetricInput');
    const ruleSeverityInput = document.getElementById('ruleSeverityInput');
    const ruleThresholdInput = document.getElementById('ruleThresholdInput');
    const ruleDebounceInput = document.getElementById('ruleDebounceInput');
    const ruleCooldownInput = document.getElementById('ruleCooldownInput');
    const ruleEnabledInput = document.getElementById('ruleEnabledInput');
    const saveRuleBtn = document.getElementById('saveRuleBtn');
    const ruleEditorStatus = document.getElementById('ruleEditorStatus');
    const activeAlertCount = document.getElementById('activeAlertCount');
    const historyAlertCount = document.getElementById('historyAlertCount');
    const alertStreamLog = document.getElementById('alertStreamLog');
    const alertStreamCount = document.getElementById('alertStreamCount');
    const alertSocketState = document.getElementById('alertSocketState');
    const alertStreamSource = document.getElementById('alertStreamSource');
    const alertWorkflowAlertId = document.getElementById('alertWorkflowAlertId');
    const alertAckNote = document.getElementById('alertAckNote');
    const alertResolveNote = document.getElementById('alertResolveNote');
    const alertUseFirstBtn = document.getElementById('alertUseFirstBtn');
    const alertAckBtn = document.getElementById('alertAckBtn');
    const alertResolveBtn = document.getElementById('alertResolveBtn');
    const alertWorkflowStatus = document.getElementById('alertWorkflowStatus');
    const refreshAlertSummaryBtn = document.getElementById('refreshAlertSummaryBtn');
    const alertSummaryTotal = document.getElementById('alertSummaryTotal');
    const alertSummarySuppressed = document.getElementById('alertSummarySuppressed');
    const alertSummaryCoalesced = document.getElementById('alertSummaryCoalesced');
    const alertSummaryFlapping = document.getElementById('alertSummaryFlapping');
    const alertSummaryList = document.getElementById('alertSummaryList');
    const incidentCount = document.getElementById('incidentCount');
    const incidentSourceAlertId = document.getElementById('incidentSourceAlertId');
    const incidentIdInput = document.getElementById('incidentIdInput');
    const incidentTitleInput = document.getElementById('incidentTitleInput');
    const incidentSeverityInput = document.getElementById('incidentSeverityInput');
    const incidentOwnerInput = document.getElementById('incidentOwnerInput');
    const incidentSiteInput = document.getElementById('incidentSiteInput');
    const incidentNoteInput = document.getElementById('incidentNoteInput');
    const incidentStatusFilter = document.getElementById('incidentStatusFilter');
    const incidentSeverityFilter = document.getElementById('incidentSeverityFilter');
    const incidentOwnerFilter = document.getElementById('incidentOwnerFilter');
    const incidentSiteFilter = document.getElementById('incidentSiteFilter');
    const incidentFromFilter = document.getElementById('incidentFromFilter');
    const incidentToFilter = document.getElementById('incidentToFilter');
    const refreshIncidentsBtn = document.getElementById('refreshIncidentsBtn');
    const incidentUseAlertBtn = document.getElementById('incidentUseAlertBtn');
    const createIncidentBtn = document.getElementById('createIncidentBtn');
    const assignIncidentBtn = document.getElementById('assignIncidentBtn');
    const incidentNoteBtn = document.getElementById('incidentNoteBtn');
    const resolveIncidentBtn = document.getElementById('resolveIncidentBtn');
    const closeIncidentBtn = document.getElementById('closeIncidentBtn');
    const incidentList = document.getElementById('incidentList');
    const incidentWorkflowStatus = document.getElementById('incidentWorkflowStatus');
    const refreshIncidentSummaryBtn = document.getElementById('refreshIncidentSummaryBtn');
    const incidentSummaryTotal = document.getElementById('incidentSummaryTotal');
    const incidentSummaryOpen = document.getElementById('incidentSummaryOpen');
    const incidentSummaryAssigned = document.getElementById('incidentSummaryAssigned');
    const incidentSummaryClosed = document.getElementById('incidentSummaryClosed');
    const incidentSummaryList = document.getElementById('incidentSummaryList');
    const refreshIncidentTimelineBtn = document.getElementById('refreshIncidentTimelineBtn');
    const incidentTimelineTarget = document.getElementById('incidentTimelineTarget');
    const incidentTimelineCount = document.getElementById('incidentTimelineCount');
    const incidentTimelineList = document.getElementById('incidentTimelineList');
    const handoverAccessBadge = document.getElementById('handoverAccessBadge');
    const handoverExportFormat = document.getElementById('handoverExportFormat');
    const handoverExportLimit = document.getElementById('handoverExportLimit');
    const runHandoverBtn = document.getElementById('runHandoverBtn');
    const handoverStatus = document.getElementById('handoverStatus');
    const handoverSnapshot = document.getElementById('handoverSnapshot');
    const fleetGroupName = document.getElementById('fleetGroupName');
    const fleetSiteFilter = document.getElementById('fleetSiteFilter');
    const fleetZoneFilter = document.getElementById('fleetZoneFilter');
    const fleetStatusFilter = document.getElementById('fleetStatusFilter');
    const fleetSearchFilter = document.getElementById('fleetSearchFilter');
    const fleetSaveGroupBtn = document.getElementById('fleetSaveGroupBtn');
    const fleetGroupCount = document.getElementById('fleetGroupCount');
    const fleetGroupList = document.getElementById('fleetGroupList');
    const fleetPreviewCount = document.getElementById('fleetPreviewCount');
    const fleetConfigJson = document.getElementById('fleetConfigJson');
    const fleetPreviewBtn = document.getElementById('fleetPreviewBtn');
    const fleetDryRunBtn = document.getElementById('fleetDryRunBtn');
    const fleetApplyBtn = document.getElementById('fleetApplyBtn');
    const fleetBatchTotal = document.getElementById('fleetBatchTotal');
    const fleetBatchSuccess = document.getElementById('fleetBatchSuccess');
    const fleetBatchFailed = document.getElementById('fleetBatchFailed');
    const fleetBatchStatus = document.getElementById('fleetBatchStatus');
    const fleetPreviewList = document.getElementById('fleetPreviewList');
    const fleetAccessBadge = document.getElementById('fleetAccessBadge');
    const auditLogCount = document.getElementById('auditLogCount');
    const auditDeviceId = document.getElementById('auditDeviceId');
    const auditCommandId = document.getElementById('auditCommandId');
    const auditLimit = document.getElementById('auditLimit');
    const auditLogList = document.getElementById('auditLogList');
    const refreshAuditLogsBtn = document.getElementById('refreshAuditLogsBtn');

    serverUrlEl.textContent = location.origin;

    const state = {
      auth: {
        role: 'viewer',
        token: '',
        authIssue: '',
      },
      rules: [],
      activeAlerts: [],
      historyAlerts: [],
      alertSummary: null,
      incidents: [],
      incidentSummary: null,
      incidentTimeline: null,
      telemetryLines: [],
      alertLines: [],
      auditLogs: [],
      devices: [],
      fleetGroups: [],
      fleetPreview: [],
      fleetBatchResult: {
        total: 0,
        success: 0,
        failed: 0,
      },
      alertCount: 0,
    };

    const maxTelemetryLines = 120;
    const maxAlertLines = 100;
    const activeStatuses = new Set(['active', 'open', 'opened', 'triggered', 'firing', 'unresolved', 'ongoing']);
    const historyStatuses = new Set(['resolved', 'closed', 'cleared', 'archived', 'acknowledged', 'suppressed']);
    const AUTH_STORAGE_KEY = 'dashboard-test-auth-v1';
    const ROLE_DEFAULT_TOKENS = {
      admin: 'admin-local-key',
      operator: 'operator-local-key',
      viewer: 'viewer-local-key',
    };
    const FLEET_GROUP_STORAGE_KEY = 'dashboard-test-fleet-groups-v1';
    const ROLE_CAPABILITIES = {
      viewer: { canSendCommand: false, canEditRules: false },
      operator: { canSendCommand: true, canEditRules: false },
      admin: { canSendCommand: true, canEditRules: true },
    };
    loadAuthState();
    loadFleetGroups();
    syncAuthUi();

    function normalizeRole(value) {
      const role = String(value || '').toLowerCase();
      return Object.prototype.hasOwnProperty.call(ROLE_CAPABILITIES, role) ? role : 'viewer';
    }

    function getRoleLabel(role) {
      const normalized = normalizeRole(role);
      return normalized.charAt(0).toUpperCase() + normalized.slice(1);
    }

    function canSendCommand() {
      return ROLE_CAPABILITIES[normalizeRole(state.auth.role)].canSendCommand;
    }

    function canEditRules() {
      return ROLE_CAPABILITIES[normalizeRole(state.auth.role)].canEditRules;
    }

    function canViewAuditLogs() {
      return normalizeRole(state.auth.role) === 'admin';
    }

    function tokenPreview(token) {
      const value = String(token || '').trim();
      if (!value) {
        return 'none';
      }
      if (value.length <= 10) {
        return value;
      }
      return value.slice(0, 4) + '…' + value.slice(-4);
    }

    function getAuthHeaders() {
      const headers = {
        'X-Dashboard-Role': normalizeRole(state.auth.role),
      };
      const token = String(state.auth.token || '').trim();
      if (token) {
        headers.Authorization = token.toLowerCase().startsWith('bearer ') ? token : 'Bearer ' + token;
      }
      return headers;
    }

    function setAuthBanner(message, level) {
      if (!authBanner) {
        return;
      }
      if (!message) {
        authBanner.textContent = '';
        authBanner.classList.remove('show', 'danger');
        return;
      }
      authBanner.textContent = message;
      authBanner.classList.add('show');
      authBanner.classList.toggle('danger', level === 'danger');
    }

    function setAuthIssue(message, status) {
      const statusLabel = status ? 'HTTP ' + status + ': ' : '';
      state.auth.authIssue = message ? statusLabel + message : '';
      if (!message) {
        setAuthBanner('', '');
        return;
      }
      setAuthBanner(statusLabel + message, status === 403 || status === 401 ? 'danger' : 'warn');
    }

    function getAuthFailureHint(resourceName) {
      const issue = String(state.auth.authIssue || '');
      if (!issue) {
        return '';
      }
      if (issue.includes('401')) {
        return resourceName + ' unauthorized (401). Check token and selected role.';
      }
      if (issue.includes('403')) {
        return resourceName + ' forbidden (403). The selected role is not allowed.';
      }
      return resourceName + ' blocked by auth.';
    }

    function saveAuthState() {
      try {
        localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({
          role: state.auth.role,
          token: state.auth.token,
        }));
      } catch (err) {
        // Ignore localStorage failures in private or restricted contexts.
      }
    }

    function loadAuthState() {
      try {
        const raw = localStorage.getItem(AUTH_STORAGE_KEY);
        if (!raw) {
          return;
        }
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          state.auth.role = normalizeRole(parsed.role);
          state.auth.token = String(parsed.token || '');
        }
      } catch (err) {
        // Ignore malformed persisted auth state.
      }

      if (!String(state.auth.token || '').trim()) {
        state.auth.token = ROLE_DEFAULT_TOKENS[normalizeRole(state.auth.role)];
      }
    }

    function syncAuthUi() {
      if (authRole) {
        authRole.value = normalizeRole(state.auth.role);
      }
      if (authToken) {
        authToken.value = String(state.auth.token || '');
      }
      if (authRoleLabel) {
        authRoleLabel.textContent = getRoleLabel(state.auth.role);
      }
      if (authTokenLabel) {
        authTokenLabel.textContent = tokenPreview(state.auth.token);
      }
      if (authHeaderLabel) {
        const headerNames = ['X-Dashboard-Role'];
        if (String(state.auth.token || '').trim()) {
          headerNames.unshift('Authorization');
        }
        authHeaderLabel.textContent = headerNames.join(', ');
      }
      if (commandAccessBadge) {
        commandAccessBadge.textContent = canSendCommand() ? 'operator+' : 'operator+ locked';
      }
      if (ruleAccessBadge) {
        ruleAccessBadge.textContent = canEditRules() ? 'admin only' : 'admin only locked';
      }
      if (handoverAccessBadge) {
        handoverAccessBadge.textContent = canViewAuditLogs() ? 'admin export ready' : 'admin only locked';
      }
      if (fleetAccessBadge) {
        fleetAccessBadge.textContent = canSendCommand() ? 'operator+' : 'operator+ locked';
      }
      sendCmdBtn.disabled = !canSendCommand();
      sendCmdBtn.title = canSendCommand() ? 'Send command with current auth headers' : 'Select operator or admin to send commands';
      saveRuleBtn.disabled = !canEditRules();
      saveRuleBtn.title = canEditRules() ? 'Create or update alert rules' : 'Select admin to create or update rules';
      runHandoverBtn.disabled = !canViewAuditLogs();
      runHandoverBtn.title = canViewAuditLogs()
        ? 'Export incidents and bundle handover snapshot'
        : 'Select admin role to use incident export';
      fleetApplyBtn.disabled = !canSendCommand();
      fleetApplyBtn.title = canSendCommand()
        ? 'Dispatch set_config to matched devices'
        : 'Select operator or admin to apply fleet config';
    }

    function applyAuthState(nextRole, nextToken) {
      state.auth.role = normalizeRole(nextRole);
      const normalizedToken = String(nextToken || '').trim();
      state.auth.token = normalizedToken || ROLE_DEFAULT_TOKENS[normalizeRole(state.auth.role)];
      state.auth.authIssue = '';
      saveAuthState();
      setAuthIssue('', 0);
      syncAuthUi();
    }

    function loadFleetGroups() {
      try {
        const raw = localStorage.getItem(FLEET_GROUP_STORAGE_KEY);
        if (!raw) {
          state.fleetGroups = [];
          return;
        }
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
          state.fleetGroups = [];
          return;
        }
        state.fleetGroups = parsed
          .filter((item) => item && typeof item === 'object')
          .map((item) => ({
            id: safeString(item.id),
            name: safeString(item.name),
            filters: sanitizeFleetFilters(item.filters || {}),
            configText: typeof item.configText === 'string' ? item.configText : '',
            createdAt: safeString(item.createdAt),
          }))
          .filter((item) => item.name !== '-');
      } catch (err) {
        state.fleetGroups = [];
      }
    }

    function persistFleetGroups() {
      try {
        localStorage.setItem(FLEET_GROUP_STORAGE_KEY, JSON.stringify(state.fleetGroups));
      } catch (err) {
        // Ignore localStorage failures in restricted contexts.
      }
    }

    function sanitizeFleetFilters(filters) {
      if (!filters || typeof filters !== 'object') {
        return { site: '', zone: '', status: '', search: '' };
      }
      const status = String(filters.status || '').trim().toLowerCase();
      return {
        site: String(filters.site || '').trim(),
        zone: String(filters.zone || '').trim(),
        status: status === 'online' || status === 'offline' ? status : '',
        search: String(filters.search || '').trim(),
      };
    }

    function getFleetFiltersFromForm() {
      return sanitizeFleetFilters({
        site: fleetSiteFilter.value,
        zone: fleetZoneFilter.value,
        status: fleetStatusFilter.value,
        search: fleetSearchFilter.value,
      });
    }

    function applyFleetFiltersToForm(filters) {
      const normalized = sanitizeFleetFilters(filters);
      fleetSiteFilter.value = normalized.site;
      fleetZoneFilter.value = normalized.zone;
      fleetStatusFilter.value = normalized.status;
      fleetSearchFilter.value = normalized.search;
    }

    function buildFleetDeviceQuery(filters) {
      const normalized = sanitizeFleetFilters(filters);
      const params = new URLSearchParams();
      if (normalized.site) {
        params.set('site', normalized.site);
      }
      if (normalized.zone) {
        params.set('zone', normalized.zone);
      }
      if (normalized.status) {
        params.set('status', normalized.status);
      }
      if (normalized.search) {
        params.set('search', normalized.search);
      }
      return params;
    }

    function parseFleetConfigPayload() {
      const raw = String(fleetConfigJson.value || '').trim();
      if (!raw) {
        fleetBatchStatus.textContent = 'Config JSON is required';
        return null;
      }
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          fleetBatchStatus.textContent = 'Config payload must be a JSON object';
          return null;
        }
        return parsed;
      } catch (err) {
        fleetBatchStatus.textContent = 'Config JSON invalid';
        return null;
      }
    }

    function renderFleetBatchResult() {
      const result = state.fleetBatchResult || { total: 0, success: 0, failed: 0 };
      fleetBatchTotal.textContent = String(result.total || 0);
      fleetBatchSuccess.textContent = String(result.success || 0);
      fleetBatchFailed.textContent = String(result.failed || 0);
    }

    function renderFleetGroups() {
      fleetGroupCount.textContent = String(state.fleetGroups.length);
      renderList(fleetGroupList, state.fleetGroups, 'No cohort presets yet.', (group) => {
        const card = createCard(
          safeString(group.name),
          safeString('site=' + (group.filters.site || '*') + ' · zone=' + (group.filters.zone || '*')),
          safeString(group.filters.status || 'all'),
          'neutral',
          [
            { label: 'Search', value: safeString(group.filters.search || '-') },
            { label: 'Saved', value: safeString(group.createdAt) },
          ],
          safeString(group.configText || '{}'),
        );

        appendActionRow(card, [
          {
            label: 'Load',
            variant: 'secondary',
            onClick: () => {
              fleetGroupName.value = safeString(group.name);
              applyFleetFiltersToForm(group.filters);
              if (group.configText && group.configText !== '-') {
                fleetConfigJson.value = group.configText;
              }
              fleetBatchStatus.textContent = 'Loaded cohort preset ' + safeString(group.name);
            },
          },
          {
            label: 'Preview',
            variant: 'secondary',
            onClick: () => {
              applyFleetFiltersToForm(group.filters);
              if (group.configText && group.configText !== '-') {
                fleetConfigJson.value = group.configText;
              }
              void previewFleetDevices();
            },
          },
        ]);
        return card;
      });
    }

    function renderFleetPreview() {
      fleetPreviewCount.textContent = String(state.fleetPreview.length);
      renderList(
        fleetPreviewList,
        state.fleetPreview,
        'Run preview to inspect matched devices.',
        (device) => {
          const metadata = device && device.metadata && typeof device.metadata === 'object' ? device.metadata : {};
          return createCard(
            safeString(device && device.deviceId),
            safeString((metadata.name ? metadata.name + ' · ' : '') + 'site ' + (metadata.site || '-') + ' · zone ' + (metadata.zone || '-')),
            safeString(device && device.online ? 'online' : 'offline'),
            device && device.online ? 'ok' : 'neutral',
            [
              { label: 'Firmware', value: safeString(metadata.firmwareVersion || '-') },
              { label: 'Sensor', value: safeString(metadata.sensorVersion || '-') },
            ],
            safeString(metadata.notes || ''),
          );
        },
      );
    }

    async function previewFleetDevices() {
      const params = buildFleetDeviceQuery(getFleetFiltersFromForm());
      const url = params.toString() ? '/api/devices?' + params.toString() : '/api/devices';
      fleetBatchStatus.textContent = 'Loading cohort preview...';

      const payload = await fetchJsonMaybe(url);
      if (!payload) {
        state.fleetPreview = [];
        renderFleetPreview();
        fleetBatchStatus.textContent = getAuthFailureHint('Fleet device API') || 'Fleet preview unavailable.';
        return null;
      }

      state.fleetPreview = normalizeArray(payload);
      renderFleetPreview();
      fleetBatchStatus.textContent = 'Preview matched ' + String(state.fleetPreview.length) + ' devices';
      return state.fleetPreview;
    }

    function saveFleetPreset() {
      const name = String(fleetGroupName.value || '').trim();
      if (!name) {
        fleetBatchStatus.textContent = 'Cohort name is required';
        return;
      }

      const filters = getFleetFiltersFromForm();
      const configText = String(fleetConfigJson.value || '').trim();
      const now = new Date().toISOString();
      const existingIndex = state.fleetGroups.findIndex((item) => item && item.name === name);
      const entry = {
        id: existingIndex >= 0 ? state.fleetGroups[existingIndex].id : 'cohort-' + Date.now(),
        name,
        filters,
        configText,
        createdAt: now,
      };

      if (existingIndex >= 0) {
        state.fleetGroups.splice(existingIndex, 1);
      }
      state.fleetGroups.unshift(entry);
      state.fleetGroups = state.fleetGroups.slice(0, 30);
      persistFleetGroups();
      renderFleetGroups();
      fleetBatchStatus.textContent = 'Saved cohort preset ' + name;
    }

    function chunkArray(items, size) {
      const chunks = [];
      for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
      }
      return chunks;
    }

    async function runFleetDryRun() {
      const config = parseFleetConfigPayload();
      if (!config) {
        return;
      }
      const preview = await previewFleetDevices();
      if (!preview) {
        return;
      }
      state.fleetBatchResult = {
        total: preview.length,
        success: 0,
        failed: 0,
      };
      renderFleetBatchResult();
      fleetBatchStatus.textContent = 'Dry-run ready: ' + String(preview.length) + ' devices would receive set_config';
    }

    async function applyFleetConfig() {
      if (!canSendCommand()) {
        fleetBatchStatus.textContent = 'Operator or admin role required to apply fleet config';
        return;
      }

      const config = parseFleetConfigPayload();
      if (!config) {
        return;
      }

      let targets = state.fleetPreview;
      if (!targets.length) {
        const preview = await previewFleetDevices();
        targets = preview || [];
      }

      if (!targets.length) {
        fleetBatchStatus.textContent = 'No target devices matched current cohort filters';
        return;
      }

      let success = 0;
      let failed = 0;
      let dispatched = 0;
      state.fleetBatchResult = { total: targets.length, success: 0, failed: 0 };
      renderFleetBatchResult();
      fleetBatchStatus.textContent = 'Dispatching set_config to ' + String(targets.length) + ' devices...';

      const chunks = chunkArray(targets, 20);
      for (const chunk of chunks) {
        const results = await Promise.all(
          chunk.map((device) => {
            const deviceId = safeString(device && device.deviceId);
            if (!deviceId || deviceId === '-') {
              return Promise.resolve({ ok: false, status: 0, payload: { error: 'invalid_device_id' } });
            }
            return requestJson('/api/devices/' + encodeURIComponent(deviceId) + '/commands', {
              method: 'POST',
              body: {
                type: 'set_config',
                payload: config,
              },
            });
          }),
        );

        results.forEach((result) => {
          dispatched += 1;
          if (result.ok && result.payload && result.payload.ok) {
            success += 1;
            return;
          }
          failed += 1;
        });

        state.fleetBatchResult = {
          total: targets.length,
          success,
          failed,
        };
        renderFleetBatchResult();
        fleetBatchStatus.textContent =
          'Dispatch progress: ' + String(dispatched) + '/' + String(targets.length) +
          ' | accepted=' + String(success) + ' | failed=' + String(failed);
      }

      fleetBatchStatus.textContent =
        'Fleet apply done: dispatched=' + String(targets.length) +
        ', accepted=' + String(success) + ', failed=' + String(failed);
      void refreshAuditLogs();
      void refreshDevices();
    }

    function isAuthFailure(status) {
      return status === 401 || status === 403;
    }

    function describeApiFailure(result, label) {
      const payload = result && result.payload && typeof result.payload === 'object' ? result.payload : {};
      const status = Number(result && result.status) || 0;
      const error = safeString(payload.error || payload.message || '');
      const reason = safeString(payload.reason || '');
      const action = safeString(payload.action || '');

      if (isAuthFailure(status)) {
        return getAuthFailureHint(label) || (label + ' failed: unauthorized');
      }

      const bits = [];
      bits.push(label + ' failed');
      if (status > 0) {
        bits.push('(' + status + ')');
      }
      if (error && error !== '-') {
        bits.push(error);
      }
      if (reason && reason !== '-') {
        bits.push('reason=' + reason);
      }
      if (action && action !== '-') {
        bits.push('action=' + action);
      }
      return bits.join(' | ');
    }

    async function requestJson(url, options = {}) {
      try {
        const response = await fetch(url, {
          method: options.method || 'GET',
          headers: {
            Accept: 'application/json',
            ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            ...getAuthHeaders(),
            ...(options.headers || {}),
          },
          body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        });
        const text = await response.text();
        let payload = null;
        if (text) {
          try {
            payload = JSON.parse(text);
          } catch (err) {
            payload = { raw: text };
          }
        }
        if (isAuthFailure(response.status)) {
          const detail = (payload && (payload.error || payload.message)) || 'Request rejected by the server.';
          setAuthIssue(detail, response.status);
        }
        return { ok: response.ok, status: response.status, payload };
      } catch (err) {
        return { ok: false, status: 0, payload: { error: String(err) } };
      }
    }

    function safeString(value) {
      if (value === null || value === undefined || value === '') {
        return '-';
      }
      if (typeof value === 'string') {
        return value;
      }
      if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
      }
      try {
        return JSON.stringify(value);
      } catch (err) {
        return String(value);
      }
    }

    function safeJson(value) {
      try {
        return JSON.stringify(value, null, 2);
      } catch (err) {
        return safeString(value);
      }
    }

    function normalizeArray(value) {
      if (Array.isArray(value)) {
        return value;
      }
      if (!value || typeof value !== 'object') {
        return [];
      }
      const candidates = [
        value.data,
        value.items,
        value.results,
        value.alerts,
        value.rules,
        value.records,
        value.list,
      ];
      for (const candidate of candidates) {
        if (Array.isArray(candidate)) {
          return candidate;
        }
      }
      return [];
    }

    function unwrapPayload(payload) {
      if (!payload || typeof payload !== 'object') {
        return payload;
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'data')) {
        return payload.data;
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'items')) {
        return payload.items;
      }
      if (Object.prototype.hasOwnProperty.call(payload, 'results')) {
        return payload.results;
      }
      return payload;
    }

    function getAlertKey(alert) {
      if (!alert || typeof alert !== 'object') {
        return String(alert);
      }
      return String(
        alert.alertId || alert.alert_id || alert.id || alert.eventId || alert.event_id ||
        alert.ruleId || alert.rule_id || alert.name || alert.code || alert.deviceId ||
        alert.device_id || safeString(alert.createdAt || alert.timestamp || alert.updatedAt || Date.now()),
      );
    }

    function getAlertStatus(alert) {
      if (!alert || typeof alert !== 'object') {
        return 'unknown';
      }
      const raw = alert.status || alert.state || alert.phase || alert.lifecycle || alert.level || '';
      return String(raw).toLowerCase();
    }

    function isActiveAlert(alert) {
      if (!alert || typeof alert !== 'object') {
        return false;
      }
      if (alert.isActive === true || alert.active === true || alert.open === true) {
        return true;
      }
      if (alert.resolvedAt || alert.closedAt || alert.clearedAt) {
        return false;
      }
      const status = getAlertStatus(alert);
      if (activeStatuses.has(status)) {
        return true;
      }
      if (historyStatuses.has(status)) {
        return false;
      }
      return true;
    }

    function classifyAlert(alert) {
      return isActiveAlert(alert) ? 'active' : 'history';
    }

    function formatAlertTimestamp(alert) {
      const raw = alert && (alert.timestamp || alert.createdAt || alert.startedAt || alert.updatedAt || alert.detectedAt || alert.resolvedAt);
      if (!raw) {
        return '-';
      }
      const parsed = new Date(raw);
      return Number.isNaN(parsed.getTime()) ? safeString(raw) : parsed.toLocaleString();
    }

    function deriveAlertTitle(alert) {
      if (!alert || typeof alert !== 'object') {
        return safeString(alert);
      }
      return safeString(
        alert.title || alert.name || alert.ruleName || alert.rule || alert.message || alert.summary || alert.code || 'Alert',
      );
    }

    function deriveAlertSubtitle(alert) {
      if (!alert || typeof alert !== 'object') {
        return '';
      }
      const parts = [];
      const source = alert.source || alert.channel || alert.origin;
      const device = alert.deviceId || alert.device_id || alert.assetId || alert.asset_id;
      const rule = alert.ruleName || alert.rule || alert.ruleId || alert.rule_id;
      if (source) parts.push(String(source));
      if (device) parts.push('device ' + String(device));
      if (rule && String(rule) !== String(source)) parts.push('rule ' + String(rule));
      return parts.join(' · ');
    }

    function deriveAlertNoiseMetrics(alert) {
      const occurrenceCount = Number(
        alert && (alert.occurrenceCount || alert.occurrence_count || alert.repeatCount || 1),
      );
      const suppressedCount = Number(
        alert && (alert.suppressedCount || alert.suppressed_count || alert.silencedCount || 0),
      );
      const noiseState = safeString(
        alert && (alert.noiseState || alert.noise_state || alert.noiseLabel || 'normal'),
      );
      return [
        { label: 'Device', value: safeString(alert && (alert.deviceId || alert.device_id || '-')) },
        { label: 'When', value: formatAlertTimestamp(alert) },
        { label: 'Occurrences', value: String(Number.isFinite(occurrenceCount) ? occurrenceCount : 1) },
        { label: 'Suppressed', value: String(Number.isFinite(suppressedCount) ? suppressedCount : 0) },
        { label: 'Noise', value: noiseState || 'normal' },
      ];
    }

    function deriveRuleTitle(rule) {
      if (!rule || typeof rule !== 'object') {
        return safeString(rule);
      }
      return safeString(rule.name || rule.title || rule.ruleName || rule.id || rule.ruleId || 'Rule');
    }

    function deriveRuleSubtitle(rule) {
      if (!rule || typeof rule !== 'object') {
        return '';
      }
      const parts = [];
      const metric = rule.metric || rule.sensor || rule.signal;
      const severity = rule.severity || rule.priority;
      const enabled = rule.enabled;
      if (metric) parts.push(String(metric));
      if (severity) parts.push('severity ' + String(severity));
      if (typeof enabled === 'boolean') parts.push(enabled ? 'enabled' : 'disabled');
      return parts.join(' · ');
    }

    function formatAuditTimestamp(log) {
      const raw = log && (log.createdAt || log.timestamp || log.at || log.time || log.occurredAt);
      if (!raw) {
        return '-';
      }
      const parsed = new Date(raw);
      return Number.isNaN(parsed.getTime()) ? safeString(raw) : parsed.toLocaleString();
    }

    function deriveAuditTitle(log) {
      if (!log || typeof log !== 'object') {
        return safeString(log);
      }
      return safeString(log.action || log.event || log.type || log.name || 'Audit Entry');
    }

    function deriveAuditSubtitle(log) {
      if (!log || typeof log !== 'object') {
        return '';
      }
      const parts = [];
      if (log.deviceId || log.device_id) parts.push('device ' + String(log.deviceId || log.device_id));
      if (log.commandId || log.command_id) parts.push('command ' + String(log.commandId || log.command_id));
      if (log.actor || log.user || log.userId) parts.push('by ' + String(log.actor || log.user || log.userId));
      return parts.join(' · ');
    }

    function deriveIncidentTitle(incident) {
      if (!incident || typeof incident !== 'object') {
        return safeString(incident);
      }
      return safeString(
        incident.title || incident.summary || incident.name || incident.incidentId || incident.id || 'Incident',
      );
    }

    function deriveIncidentSubtitle(incident) {
      if (!incident || typeof incident !== 'object') {
        return '';
      }
      const parts = [];
      if (incident.incidentId || incident.id) parts.push('id ' + String(incident.incidentId || incident.id));
      if (incident.owner || incident.assignee) parts.push('owner ' + String(incident.owner || incident.assignee));
      if (incident.site) parts.push('site ' + String(incident.site));
      if (incident.severity) parts.push('severity ' + String(incident.severity));
      return parts.join(' · ');
    }

    function formatIncidentTimestamp(incident) {
      const raw = incident && (
        incident.createdAt ||
        incident.updatedAt ||
        incident.openedAt ||
        incident.acknowledgedAt ||
        incident.resolvedAt ||
        incident.closedAt
      );
      if (!raw) {
        return '-';
      }
      const parsed = new Date(raw);
      return Number.isNaN(parsed.getTime()) ? safeString(raw) : parsed.toLocaleString();
    }

    function deriveIncidentStatus(incident) {
      if (!incident || typeof incident !== 'object') {
        return 'unknown';
      }
      return String(incident.status || incident.state || incident.phase || incident.lifecycle || 'open').toLowerCase();
    }

    function normalizeIncidentList(payload) {
      const unwrapped = unwrapPayload(payload);
      if (Array.isArray(unwrapped)) {
        return unwrapped;
      }
      if (!unwrapped || typeof unwrapped !== 'object') {
        return [];
      }
      return normalizeArray(
        unwrapped.incidents || unwrapped.items || unwrapped.records || unwrapped.list || unwrapped.data,
      );
    }

    function normalizeAlertSummary(payload) {
      const unwrapped = unwrapPayload(payload);
      if (!unwrapped || typeof unwrapped !== 'object') {
        return null;
      }
      return unwrapped;
    }

    function normalizeIncidentSummary(payload) {
      const unwrapped = unwrapPayload(payload);
      if (!unwrapped || typeof unwrapped !== 'object') {
        return null;
      }
      return unwrapped;
    }

    function normalizeIncidentTimeline(payload) {
      const unwrapped = unwrapPayload(payload);
      if (Array.isArray(unwrapped)) {
        return {
          incident: null,
          entries: unwrapped,
          returnedEntries: unwrapped.length,
        };
      }
      if (!unwrapped || typeof unwrapped !== 'object') {
        return null;
      }
      const entries = normalizeArray(unwrapped.entries || unwrapped.items || unwrapped.data);
      return {
        incident: unwrapped.incident || null,
        entries,
        returnedEntries: Number(unwrapped.returnedEntries || entries.length || 0),
        firstEntryAt: unwrapped.firstEntryAt,
        lastEntryAt: unwrapped.lastEntryAt,
      };
    }

    function badgeClassForIncidentStatus(status) {
      const normalized = String(status || '').toLowerCase();
      if (normalized === 'resolved' || normalized === 'closed') {
        return 'ok';
      }
      if (normalized === 'assigned' || normalized === 'monitoring') {
        return 'warn';
      }
      if (normalized === 'open') {
        return 'danger';
      }
      return 'neutral';
    }

    function badgeClassForStatus(status, fallback) {
      const normalized = String(status || '').toLowerCase();
      if (activeStatuses.has(normalized) || normalized === 'active') {
        return 'danger';
      }
      if (historyStatuses.has(normalized) || normalized === 'resolved' || normalized === 'closed') {
        return 'ok';
      }
      return fallback || 'neutral';
    }

    function createMetricChip(label, value) {
      const chip = document.createElement('div');
      chip.className = 'metric';
      const text = document.createElement('span');
      text.textContent = label + ' ';
      const strong = document.createElement('strong');
      strong.textContent = value;
      chip.appendChild(text);
      chip.appendChild(strong);
      return chip;
    }

    function createCard(title, subtitle, statusText, statusClass, metrics, bodyText) {
      const card = document.createElement('div');
      card.className = 'card';

      const head = document.createElement('div');
      head.className = 'card-head';

      const titleWrap = document.createElement('div');
      titleWrap.className = 'card-title';
      const strong = document.createElement('strong');
      strong.textContent = title;
      titleWrap.appendChild(strong);
      if (subtitle) {
        const sub = document.createElement('span');
        sub.textContent = subtitle;
        titleWrap.appendChild(sub);
      }
      head.appendChild(titleWrap);

      if (statusText) {
        const badge = document.createElement('div');
        badge.className = 'badge ' + (statusClass || 'neutral');
        badge.textContent = statusText;
        head.appendChild(badge);
      }

      card.appendChild(head);

      if (metrics && metrics.length) {
        const metricWrap = document.createElement('div');
        metricWrap.className = 'metrics';
        metrics.forEach((metric) => {
          const chip = document.createElement('div');
          chip.className = 'metric';
          const label = document.createElement('span');
          label.textContent = metric.label + ': ';
          const value = document.createElement('strong');
          value.textContent = metric.value;
          chip.appendChild(label);
          chip.appendChild(value);
          metricWrap.appendChild(chip);
        });
        card.appendChild(metricWrap);
      }

      if (bodyText) {
        const body = document.createElement('div');
        body.className = 'card-meta';
        body.textContent = bodyText;
        card.appendChild(body);
      }

      return card;
    }

    function appendActionRow(card, actions) {
      if (!actions || !actions.length) {
        return;
      }

      const row = document.createElement('div');
      row.className = 'split';
      row.style.marginTop = '4px';
      row.style.gridTemplateColumns = 'repeat(' + actions.length + ', minmax(0, 1fr))';

      actions.forEach((action) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = action.label;
        if (action.variant === 'secondary') {
          button.className = 'secondary';
        }
        button.addEventListener('click', action.onClick);
        row.appendChild(button);
      });

      card.appendChild(row);
    }

    function renderList(container, items, emptyText, builder) {
      container.replaceChildren();
      if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = emptyText;
        container.appendChild(empty);
        return;
      }
      items.forEach((item) => {
        container.appendChild(builder(item));
      });
    }

    function renderAlertSummary(summary) {
      const normalized = normalizeAlertSummary(summary);
      state.alertSummary = normalized;
      if (!normalized) {
        alertSummaryTotal.textContent = '0';
        alertSummarySuppressed.textContent = '0';
        alertSummaryCoalesced.textContent = '0';
        alertSummaryFlapping.textContent = '0';
        alertSummaryList.replaceChildren(makeEmpty('Alert summary unavailable.'));
        return;
      }

      alertSummaryTotal.textContent = String(normalized.total || 0);
      alertSummarySuppressed.textContent = String(normalized.suppressedSignals || 0);
      alertSummaryCoalesced.textContent = String(normalized.coalescedSignals || 0);
      alertSummaryFlapping.textContent = String(normalized.flappingSignals || 0);

      const cards = [
        createCard(
          'Noise Mix',
          'Stored alert record classification',
          'summary',
          'neutral',
          [
            { label: 'Normal', value: String((normalized.byNoiseState && normalized.byNoiseState.normal) || 0) },
            { label: 'Coalesced', value: String((normalized.byNoiseState && normalized.byNoiseState.coalesced) || 0) },
            { label: 'Suppressed', value: String((normalized.byNoiseState && normalized.byNoiseState.suppressed) || 0) },
            { label: 'Flapping', value: String((normalized.byNoiseState && normalized.byNoiseState.flapping) || 0) },
          ],
          '',
        ),
        createCard(
          'Noisy Rules',
          'Rules with the most suppressed/coalesced signals',
          'top',
          'neutral',
          (normalized.topNoisyRules || []).slice(0, 3).map((entry) => ({ label: entry.key, value: String(entry.count) })),
          (normalized.topNoisyRules || []).length ? '' : 'No noisy rules detected yet.',
        ),
        createCard(
          'Noisy Devices',
          'Devices producing the most alert churn',
          'top',
          'neutral',
          (normalized.topNoisyDevices || []).slice(0, 3).map((entry) => ({ label: entry.key, value: String(entry.count) })),
          (normalized.topNoisyDevices || []).length ? '' : 'No noisy devices detected yet.',
        ),
      ];

      alertSummaryList.replaceChildren(...cards);
    }

    function renderIncidentSummary(summary) {
      const normalized = normalizeIncidentSummary(summary);
      state.incidentSummary = normalized;
      if (!normalized) {
        incidentSummaryTotal.textContent = '0';
        incidentSummaryOpen.textContent = '0';
        incidentSummaryAssigned.textContent = '0';
        incidentSummaryClosed.textContent = '0';
        incidentSummaryList.replaceChildren(makeEmpty('Incident summary unavailable.'));
        return;
      }

      const byStatus = normalized.byStatus || {};
      incidentSummaryTotal.textContent = String(normalized.total || 0);
      incidentSummaryOpen.textContent = String(byStatus.open || 0);
      incidentSummaryAssigned.textContent = String((byStatus.assigned || 0) + (byStatus.monitoring || 0));
      incidentSummaryClosed.textContent = String((byStatus.resolved || 0) + (byStatus.closed || 0));

      const cards = [];
      cards.push(
        createCard(
          'Status Mix',
          'Current filtered incident distribution',
          'summary',
          'neutral',
          [
            { label: 'Open', value: String(byStatus.open || 0) },
            { label: 'Assigned', value: String(byStatus.assigned || 0) },
            { label: 'Monitoring', value: String(byStatus.monitoring || 0) },
            { label: 'Resolved', value: String(byStatus.resolved || 0) },
            { label: 'Closed', value: String(byStatus.closed || 0) },
          ],
          '',
        ),
      );
      cards.push(
        createCard(
          'Severity Mix',
          'Warning vs critical incidents',
          'summary',
          'neutral',
          [
            { label: 'Warning', value: String((normalized.bySeverity && normalized.bySeverity.warning) || 0) },
            { label: 'Critical', value: String((normalized.bySeverity && normalized.bySeverity.critical) || 0) },
          ],
          '',
        ),
      );
      cards.push(
        createCard(
          'Top Sites',
          'Most active filtered sites',
          'top',
          'neutral',
          (normalized.topSites || []).slice(0, 3).map((entry) => ({ label: entry.key, value: String(entry.count) })),
          (normalized.topSites || []).length ? '' : 'No site values in the current filtered set.',
        ),
      );
      cards.push(
        createCard(
          'Top Owners',
          'Most common incident owners',
          'top',
          'neutral',
          (normalized.topOwners || []).slice(0, 3).map((entry) => ({ label: entry.key, value: String(entry.count) })),
          (normalized.topOwners || []).length ? '' : 'No owner values in the current filtered set.',
        ),
      );

      incidentSummaryList.replaceChildren(...cards);
    }

    function renderIncidentTimeline(payload) {
      const normalized = normalizeIncidentTimeline(payload);
      state.incidentTimeline = normalized;
      if (!normalized) {
        incidentTimelineTarget.textContent = getIncidentId() || 'none';
        incidentTimelineCount.textContent = '0';
        incidentTimelineList.replaceChildren(makeEmpty('Load an incident to inspect its timeline.'));
        return;
      }

      const incident = normalized.incident;
      incidentTimelineTarget.textContent = safeString(
        (incident && (incident.incidentId || incident.id || incident.title)) || getIncidentId() || 'none',
      );
      incidentTimelineCount.textContent = String(normalized.returnedEntries || normalized.entries.length || 0);
      renderList(
        incidentTimelineList,
        normalized.entries || [],
        'No timeline entries returned for the selected incident.',
        (entry) => {
          return createCard(
            safeString(entry && (entry.type || entry.event || 'timeline')),
            safeString(entry && ('by ' + String(entry.actor || entry.user || 'unknown'))),
            formatAuditTimestamp(entry),
            'neutral',
            [
              { label: 'Actor', value: safeString(entry && (entry.actor || entry.user || '-')) },
              { label: 'At', value: formatAuditTimestamp(entry) },
            ],
            safeString(entry && (entry.message || entry.note || entry.description || entry.metadata || '')),
          );
        },
      );
    }

    function renderDevices(list) {
      deviceList.textContent = safeJson(list);
      deviceCount.textContent = String(list.filter((item) => item && item.online).length);
    }

    function syncDeviceMetadataFromSocket(message) {
      const payload = unwrapPayload(message);
      if (!payload || typeof payload !== 'object') {
        return;
      }

      const deviceId = typeof payload.deviceId === 'string' ? payload.deviceId.trim() : '';
      if (!deviceId) {
        return;
      }

      const metadataPayload =
        payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
          ? payload.metadata
          : {};

      const existingIndex = state.devices.findIndex((item) => item && item.deviceId === deviceId);
      const existing =
        existingIndex >= 0 && state.devices[existingIndex] && typeof state.devices[existingIndex] === 'object'
          ? state.devices[existingIndex]
          : {
              deviceId,
              online: true,
              metadata: {},
            };

      const merged = {
        ...existing,
        deviceId,
        metadata: {
          ...(existing.metadata && typeof existing.metadata === 'object' ? existing.metadata : {}),
          ...metadataPayload,
        },
      };

      if (existingIndex >= 0) {
        state.devices.splice(existingIndex, 1, merged);
      } else {
        state.devices.push(merged);
      }

      renderDevices(state.devices);
    }

    function syncDeviceHeartbeatFromSocket(message) {
      const payload = unwrapPayload(message);
      if (!payload || typeof payload !== 'object') {
        return;
      }

      const deviceId = typeof payload.deviceId === 'string' ? payload.deviceId.trim() : '';
      if (!deviceId) {
        return;
      }

      const heartbeatPayload =
        payload.heartbeat && typeof payload.heartbeat === 'object' && !Array.isArray(payload.heartbeat)
          ? payload.heartbeat
          : {};

      const existingIndex = state.devices.findIndex((item) => item && item.deviceId === deviceId);
      const existing =
        existingIndex >= 0 && state.devices[existingIndex] && typeof state.devices[existingIndex] === 'object'
          ? state.devices[existingIndex]
          : {
              deviceId,
              online: true,
              metadata: {},
            };

      const merged = {
        ...existing,
        deviceId,
        connectedAt: payload.connectedAt || existing.connectedAt,
        lastHeartbeatAt: payload.lastHeartbeatAt || existing.lastHeartbeatAt,
        heartbeat: {
          ...(existing.heartbeat && typeof existing.heartbeat === 'object' ? existing.heartbeat : {}),
          ...heartbeatPayload,
        },
      };

      if (existingIndex >= 0) {
        state.devices.splice(existingIndex, 1, merged);
      } else {
        state.devices.push(merged);
      }

      renderDevices(state.devices);
    }

    function renderOpsHealth(overallPayload, readinessPayload) {
      const view = {
        overall: unwrapPayload(overallPayload),
        readiness: unwrapPayload(readinessPayload),
      };
      healthSnapshot.textContent = safeJson(view);
    }

    function summarizeMetrics(snapshot) {
      const unwrapped = unwrapPayload(snapshot);
      if (!unwrapped || typeof unwrapped !== 'object') {
        return unwrapped;
      }

      const gauges = Array.isArray(unwrapped.gauges) ? unwrapped.gauges.slice(0, 12) : [];
      const counters = Array.isArray(unwrapped.counters) ? unwrapped.counters.slice(0, 12) : [];
      const histograms = Array.isArray(unwrapped.histograms) ? unwrapped.histograms.slice(0, 8) : [];

      return { gauges, counters, histograms };
    }

    function renderOpsMetrics(payload) {
      metricsSnapshot.textContent = safeJson(summarizeMetrics(payload));
    }

    function renderTelemetryHistory(payload) {
      telemetryHistorySnapshot.textContent = safeJson(unwrapPayload(payload));
    }

    function renderTelemetry(message) {
      const line = safeJson(message);
      state.telemetryLines.push(line);
      while (state.telemetryLines.length > maxTelemetryLines) {
        state.telemetryLines.shift();
      }
      telemetryLog.textContent = state.telemetryLines.join('\\n');
      telemetryLog.scrollTop = telemetryLog.scrollHeight;
    }

    function renderAlertStreamLine(message, origin) {
      const timestamp = new Date().toLocaleTimeString();
      const summary = safeString(
        (message && (message.title || message.name || message.ruleName || message.message || message.summary)) ||
        (message && getAlertStatus(message)) ||
        'alert',
      );
      const line = '[' + timestamp + '] ' + origin + ' | ' + summary + ' | ' + safeString(message);
      state.alertLines.push(line);
      while (state.alertLines.length > maxAlertLines) {
        state.alertLines.shift();
      }
      alertStreamLog.textContent = state.alertLines.join('\\n');
      alertStreamLog.scrollTop = alertStreamLog.scrollHeight;
      state.alertCount += 1;
      alertStreamCount.textContent = String(state.alertCount);
    }

    function replaceAlertInBucket(bucket, alert) {
      const key = getAlertKey(alert);
      const list = state[bucket];
      const filtered = list.filter((item) => getAlertKey(item) !== key);
      filtered.unshift(alert);
      state[bucket] = filtered.slice(0, 50);
    }

    function removeAlertFromBucket(bucket, alert) {
      const key = getAlertKey(alert);
      state[bucket] = state[bucket].filter((item) => getAlertKey(item) !== key);
    }

    function renderAlertPanels() {
      alertRuleCount.textContent = String(state.rules.length) + ' rules';
      activeAlertCount.textContent = String(state.activeAlerts.length) + ' active';
      historyAlertCount.textContent = String(state.historyAlerts.length) + ' history';

      if (state.activeAlerts.length > 0) {
        seedWorkflowAlertId(
          safeString(state.activeAlerts[0] && (state.activeAlerts[0].alertId || state.activeAlerts[0].id || '')),
        );
      }

      renderList(alertRulesList, state.rules, 'No alert rules available from the API.', (rule) => {
        const status = String(rule && (rule.status || rule.state || (rule.enabled === false ? 'disabled' : 'enabled')) || 'enabled').toLowerCase();
        const statusText = status === 'disabled' ? 'Disabled' : status === 'enabled' ? 'Enabled' : status;
        return createCard(
          deriveRuleTitle(rule),
          deriveRuleSubtitle(rule),
          statusText,
          status === 'disabled' ? 'neutral' : 'ok',
          [
            { label: 'ID', value: safeString(rule && (rule.id || rule.ruleId || rule.rule_id || '-')) },
            { label: 'Window', value: safeString(rule && (rule.window || rule.duration || rule.period || '-')) },
          ],
          safeString(rule && (rule.description || rule.condition || rule.expression || '')),
        );
      });

      renderList(activeAlertsList, state.activeAlerts, 'No active alerts at the moment.', (alert) => {
        const status = getAlertStatus(alert);
        return createCard(
          deriveAlertTitle(alert),
          deriveAlertSubtitle(alert),
          status || 'active',
          badgeClassForStatus(status, 'danger'),
          deriveAlertNoiseMetrics(alert),
          safeString(alert && (alert.detail || alert.description || alert.message || '')),
        );
      });

      renderList(historyAlertsList, state.historyAlerts, 'No alert history has been returned yet.', (alert) => {
        const status = getAlertStatus(alert);
        return createCard(
          deriveAlertTitle(alert),
          deriveAlertSubtitle(alert),
          status || 'history',
          badgeClassForStatus(status, 'ok'),
          deriveAlertNoiseMetrics(alert),
          safeString(alert && (alert.detail || alert.description || alert.message || '')),
        );
      });
    }

    function renderIncidentList() {
      incidentCount.textContent = String(state.incidents.length) + ' incidents';
      renderList(incidentList, state.incidents, 'No incidents available for the selected filters.', (incident) => {
        const status = deriveIncidentStatus(incident);
        const card = createCard(
          deriveIncidentTitle(incident),
          deriveIncidentSubtitle(incident),
          status || 'open',
          badgeClassForIncidentStatus(status),
          [
            { label: 'Created', value: formatIncidentTimestamp(incident) },
            { label: 'Alert', value: safeString(incident && (incident.alertId || incident.alert_id || '-')) },
          ],
          safeString(
            incident &&
              (incident.note ||
                incident.description ||
                incident.summary ||
                incident.resolutionNote ||
                incident.lastNote ||
                ''),
          ),
        );

        appendActionRow(card, [
          {
            label: 'Load',
            variant: 'secondary',
            onClick: () => {
              loadIncidentIntoForm(incident);
              incidentWorkflowStatus.textContent =
                'Loaded incident ' + safeString(incident && (incident.incidentId || incident.id || ''));
            },
          },
          {
            label: 'Resolve',
            variant: 'secondary',
            onClick: () => {
              incidentIdInput.value = safeString(incident && (incident.incidentId || incident.id || ''));
              void resolveIncident();
            },
          },
          {
            label: 'Close',
            variant: 'secondary',
            onClick: () => {
              incidentIdInput.value = safeString(incident && (incident.incidentId || incident.id || ''));
              void closeIncident();
            },
          },
        ]);

        return card;
      });
    }

    function loadIncidentIntoForm(incident) {
      const incidentId = incident && (incident.incidentId || incident.id || '');
      const linkedAlertId =
        incident &&
        (incident.primaryAlertId ||
          incident.alertId ||
          incident.alert_id ||
          (Array.isArray(incident.alertIds) ? incident.alertIds[0] : ''));
      incidentIdInput.value = incidentId ? String(incidentId) : '';
      incidentSourceAlertId.value = linkedAlertId ? String(linkedAlertId) : '';
      incidentTitleInput.value = incident && (incident.title || incident.summary || incident.name || '') ? String(incident.title || incident.summary || incident.name || '') : '';
      incidentSeverityInput.value = incident && incident.severity ? String(incident.severity) : 'warning';
      incidentOwnerInput.value = incident && (incident.owner || incident.assignee || '') ? String(incident.owner || incident.assignee || '') : '';
      incidentSiteInput.value = incident && incident.site ? String(incident.site) : '';
      incidentNoteInput.value =
        incident && (incident.note || incident.description || incident.summary || '') ? String(incident.note || incident.description || incident.summary || '') : '';
      void refreshIncidentTimeline();
    }

    function renderAuditLogs() {
      auditLogCount.textContent = String(state.auditLogs.length) + ' logs';
      renderList(auditLogList, state.auditLogs, 'No audit logs returned yet.', (log) => {
        return createCard(
          deriveAuditTitle(log),
          deriveAuditSubtitle(log),
          String(log && (log.status || log.result || log.outcome || 'entry')),
          'neutral',
          [
            { label: 'When', value: formatAuditTimestamp(log) },
            { label: 'Target', value: safeString(log && (log.target || log.resource || log.entity || '-')) },
          ],
          safeString(log && (log.details || log.message || log.description || log.payload || '')),
        );
      });
    }

    function normalizeRuleList(payload) {
      const unwrapped = unwrapPayload(payload);
      if (Array.isArray(unwrapped)) {
        return unwrapped;
      }
      if (!unwrapped || typeof unwrapped !== 'object') {
        return [];
      }
      return normalizeArray(unwrapped.rules || unwrapped.alertRules || unwrapped.policyRules || unwrapped.items || unwrapped.data || unwrapped.list);
    }

    function normalizeAlertList(payload) {
      const unwrapped = unwrapPayload(payload);
      if (Array.isArray(unwrapped)) {
        return unwrapped;
      }
      if (!unwrapped || typeof unwrapped !== 'object') {
        return [];
      }
      return normalizeArray(unwrapped.alerts || unwrapped.items || unwrapped.records || unwrapped.list || unwrapped.data);
    }

    function normalizeAlertBuckets(payload) {
      const unwrapped = unwrapPayload(payload);
      const buckets = {
        rules: [],
        activeAlerts: [],
        historyAlerts: [],
      };

      if (!unwrapped) {
        return buckets;
      }

      if (Array.isArray(unwrapped)) {
        const alerts = unwrapped;
        alerts.forEach((alert) => {
          if (classifyAlert(alert) === 'active') {
            buckets.activeAlerts.push(alert);
          } else {
            buckets.historyAlerts.push(alert);
          }
        });
        return buckets;
      }

      if (typeof unwrapped === 'object') {
        const rules = normalizeArray(unwrapped.rules || unwrapped.alertRules || unwrapped.policyRules || unwrapped.data);
        const active = normalizeArray(
          unwrapped.activeAlerts || unwrapped.active || unwrapped.currentAlerts || unwrapped.openAlerts ||
          unwrapped.open || unwrapped.liveAlerts,
        );
        const history = normalizeArray(
          unwrapped.historyAlerts || unwrapped.history || unwrapped.pastAlerts || unwrapped.closedAlerts ||
          unwrapped.resolvedAlerts || unwrapped.archivedAlerts,
        );

        if (rules.length) {
          buckets.rules = rules;
        }
        if (active.length) {
          buckets.activeAlerts = active;
        }
        if (history.length) {
          buckets.historyAlerts = history;
        }

        if (!rules.length && !active.length && !history.length) {
          const alerts = normalizeArray(unwrapped.alerts || unwrapped.items || unwrapped.records || unwrapped.list);
          alerts.forEach((alert) => {
            if (classifyAlert(alert) === 'active') {
              buckets.activeAlerts.push(alert);
            } else {
              buckets.historyAlerts.push(alert);
            }
          });
        }
      }

      return buckets;
    }

    async function fetchJsonMaybe(url) {
      const result = await requestJson(url, { method: 'GET' });
      if (!result.ok) {
        return null;
      }
      return result.payload;
    }

    async function submitJsonMaybe(url, method, body) {
      return requestJson(url, { method, body });
    }

    async function refreshDevices() {
      const data = await fetchJsonMaybe('/api/devices');
      const list = normalizeArray(data);
      if (!list.length && data && typeof data === 'object' && Array.isArray(data.data)) {
        state.devices = data.data;
        renderDevices(state.devices);
        return;
      }
      if (!list.length && !data) {
        state.devices = [];
        deviceList.textContent = getAuthFailureHint('Device API') || 'Device API unavailable or returned no data.';
        deviceCount.textContent = '-';
        return;
      }
      state.devices = list;
      renderDevices(state.devices);
    }

    async function refreshOpsDashboard() {
      const [overall, readiness, metricsPayload] = await Promise.all([
        fetchJsonMaybe('/health'),
        fetchJsonMaybe('/health/ready'),
        fetchJsonMaybe('/api/ops/metrics'),
      ]);

      if (!overall && !readiness) {
        healthSnapshot.textContent = 'Health endpoints unavailable.';
      } else {
        renderOpsHealth(overall, readiness);
      }

      if (!metricsPayload) {
        metricsSnapshot.textContent = getAuthFailureHint('Metrics API') || 'Metrics snapshot unavailable.';
      } else {
        renderOpsMetrics(metricsPayload);
      }
    }

    async function refreshTelemetryHistory() {
      const deviceId = telemetryHistoryDeviceId.value.trim();
      const limit = Math.min(Math.max(Number(telemetryHistoryLimit.value) || 20, 1), 200);
      const bucketMs = Number(telemetryHistoryBucketMs.value) || 0;

      if (!deviceId) {
        telemetryHistorySnapshot.textContent = 'Device ID is required';
        return;
      }

      const params = new URLSearchParams();
      params.set('limit', String(limit));
      if (bucketMs > 0) {
        params.set('bucketMs', String(bucketMs));
      }

      const payload = await fetchJsonMaybe('/api/devices/' + encodeURIComponent(deviceId) + '/telemetry?' + params.toString());
      if (!payload) {
        telemetryHistorySnapshot.textContent = getAuthFailureHint('Telemetry history API') || 'Telemetry history unavailable.';
        return;
      }

      renderTelemetryHistory(payload);
    }

    async function refreshAlerts() {
      const [rulesPayload, activePayload, resolvedPayload, allPayload] = await Promise.all([
        fetchJsonMaybe('/api/alert-rules'),
        fetchJsonMaybe('/api/alerts?status=active&limit=25'),
        fetchJsonMaybe('/api/alerts?status=resolved&limit=50'),
        fetchJsonMaybe('/api/alerts?status=all&limit=100'),
      ]);

      if (!rulesPayload && !activePayload && !resolvedPayload && !allPayload) {
        const authHint = getAuthFailureHint('Alert API');
        alertRulesList.replaceChildren(makeEmpty(authHint || 'Alert API unavailable or returned a non-success response.'));
        activeAlertsList.replaceChildren(makeEmpty(authHint || 'Alert API unavailable or returned a non-success response.'));
        historyAlertsList.replaceChildren(makeEmpty(authHint || 'Alert API unavailable or returned a non-success response.'));
        alertRuleCount.textContent = '0 rules';
        activeAlertCount.textContent = '0 active';
        historyAlertCount.textContent = '0 history';
        return;
      }

      state.rules = normalizeRuleList(rulesPayload);
      state.activeAlerts = normalizeAlertList(activePayload);
      state.historyAlerts = normalizeAlertList(resolvedPayload);

      if (!state.activeAlerts.length && !state.historyAlerts.length) {
        const allAlerts = normalizeAlertList(allPayload);
        allAlerts.forEach((alert) => {
          if (classifyAlert(alert) === 'active') {
            state.activeAlerts.push(alert);
          } else {
            state.historyAlerts.push(alert);
          }
        });
      } else {
        if (!state.activeAlerts.length && allPayload) {
          state.activeAlerts = normalizeAlertList(allPayload).filter((alert) => classifyAlert(alert) === 'active');
        }
        if (!state.historyAlerts.length && allPayload) {
          state.historyAlerts = normalizeAlertList(allPayload).filter((alert) => classifyAlert(alert) !== 'active');
        }
      }

      renderAlertPanels();
      renderIncidentList();
    }

    async function refreshAlertSummary() {
      const payload = await fetchJsonMaybe('/api/alerts/summary');
      if (!payload) {
        renderAlertSummary(null);
        return;
      }
      renderAlertSummary(payload);
    }

    function toIsoDateFilter(value) {
      const raw = String(value || '').trim();
      if (!raw) {
        return '';
      }
      const parsed = new Date(raw);
      return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
    }

    function buildIncidentQueryParams() {
      const params = new URLSearchParams();
      params.set('limit', '25');

      const status = String(incidentStatusFilter.value || '').trim();
      const severity = String(incidentSeverityFilter.value || '').trim();
      const owner = String(incidentOwnerFilter.value || '').trim();
      const site = String(incidentSiteFilter.value || '').trim();
      const from = toIsoDateFilter(incidentFromFilter.value);
      const to = toIsoDateFilter(incidentToFilter.value);

      if (status) {
        params.set('status', status);
      }
      if (severity) {
        params.set('severity', severity);
      }
      if (owner) {
        params.set('owner', owner);
      }
      if (site) {
        params.set('site', site);
      }
      if (from) {
        params.set('from', from);
      }
      if (to) {
        params.set('to', to);
      }
      return params;
    }

    async function refreshIncidents() {
      const params = buildIncidentQueryParams();
      const payload = await fetchJsonMaybe('/api/incidents?' + params.toString());
      if (!payload) {
        state.incidents = [];
        incidentCount.textContent = '0 incidents';
        incidentList.replaceChildren(
          makeEmpty(getAuthFailureHint('Incident API') || 'Incident API unavailable or returned no data.'),
        );
        return;
      }

      state.incidents = normalizeIncidentList(payload);
      renderIncidentList();
    }

    async function refreshIncidentSummary() {
      const params = buildIncidentQueryParams();
      params.delete('limit');
      const payload = await fetchJsonMaybe('/api/incidents/summary?' + params.toString());
      if (!payload) {
        renderIncidentSummary(null);
        return;
      }
      renderIncidentSummary(payload);
    }

    async function refreshIncidentTimeline() {
      const incidentId = getIncidentId();
      if (!incidentId) {
        renderIncidentTimeline(null);
        return;
      }

      const payload = await fetchJsonMaybe('/api/incidents/' + encodeURIComponent(incidentId) + '/timeline?limit=50');
      if (!payload) {
        incidentTimelineTarget.textContent = incidentId;
        incidentTimelineCount.textContent = '0';
        incidentTimelineList.replaceChildren(
          makeEmpty(getAuthFailureHint('Incident timeline API') || 'Incident timeline unavailable.'),
        );
        return;
      }

      renderIncidentTimeline(payload);
    }

    async function runShiftHandoverSnapshot() {
      if (!canViewAuditLogs()) {
        handoverStatus.textContent = 'Admin role required for incident export';
        return;
      }

      const format = String(handoverExportFormat.value || 'json').toLowerCase() === 'ndjson' ? 'ndjson' : 'json';
      const limit = Math.min(Math.max(Number(handoverExportLimit.value) || 100, 1), 1000);
      const incidentParams = buildIncidentQueryParams();
      incidentParams.set('limit', String(limit));

      const exportParams = new URLSearchParams(incidentParams.toString());
      exportParams.set('format', format);

      handoverStatus.textContent = 'Generating handover snapshot...';

      const exportResponse = await requestJson('/api/incidents/export?' + exportParams.toString(), {
        method: 'GET',
      });
      if (!exportResponse.ok) {
        handoverStatus.textContent = describeApiFailure(exportResponse, 'Incident export');
        handoverSnapshot.textContent = safeJson(exportResponse.payload);
        return;
      }

      const summaryParams = new URLSearchParams(incidentParams.toString());
      summaryParams.delete('limit');
      const [incidentSummaryPayload, alertSummaryPayload] = await Promise.all([
        fetchJsonMaybe('/api/incidents/summary?' + summaryParams.toString()),
        fetchJsonMaybe('/api/alerts/summary'),
      ]);

      const exportPayload = exportResponse.payload || {};
      const exportData = unwrapPayload(exportPayload);
      const rawExport = exportPayload && exportPayload.raw ? String(exportPayload.raw) : '';
      const ndjsonLines = rawExport
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      const ndjsonFallbackLine =
        !ndjsonLines.length && exportData && typeof exportData === 'object' ? JSON.stringify(exportData) : '';

      const snapshot = {
        generatedAt: new Date().toISOString(),
        filters: Object.fromEntries(summaryParams.entries()),
        export:
          format === 'ndjson'
            ? {
                format: 'ndjson',
                exportedCount: ndjsonLines.length || (ndjsonFallbackLine ? 1 : 0),
                firstLine: ndjsonLines[0] || ndjsonFallbackLine || null,
              }
            : {
                format: 'json',
                exportedCount: Number(
                  exportData && typeof exportData === 'object'
                    ? exportData.exportedCount || (Array.isArray(exportData.items) ? exportData.items.length : 0)
                    : 0,
                ),
                sampleIncident:
                  exportData &&
                  typeof exportData === 'object' &&
                  Array.isArray(exportData.items) &&
                  exportData.items.length
                    ? exportData.items[0]
                    : null,
              },
        incidentSummary: unwrapPayload(incidentSummaryPayload),
        alertSummary: unwrapPayload(alertSummaryPayload),
      };

      handoverSnapshot.textContent = safeJson(snapshot);
      handoverStatus.textContent = 'Handover snapshot generated';
    }

    function getSelectedAlertId() {
      const fromInput = String(alertWorkflowAlertId.value || '').trim();
      if (fromInput) {
        return fromInput;
      }
      const first = state.activeAlerts[0];
      const fallback = first && (first.alertId || first.id || first.alert_id);
      return String(fallback || '').trim();
    }

    function seedWorkflowAlertId(alertId) {
      const normalized = String(alertId || '').trim();
      if (!normalized) {
        return;
      }

      if (!String(alertWorkflowAlertId.value || '').trim()) {
        alertWorkflowAlertId.value = normalized;
      }
      if (!String(incidentSourceAlertId.value || '').trim()) {
        incidentSourceAlertId.value = normalized;
      }
    }

    async function acknowledgeAlert() {
      const alertId = getSelectedAlertId();
      if (!alertId) {
        alertWorkflowStatus.textContent = 'Alert ID is required';
        return;
      }

      alertWorkflowStatus.textContent = 'Sending ack for ' + alertId + '...';
      const payload = {
        note: String(alertAckNote.value || '').trim() || undefined,
      };
      const result = await submitJsonMaybe('/api/alerts/' + encodeURIComponent(alertId) + '/ack', 'POST', payload);
      if (!result.ok) {
        alertWorkflowStatus.textContent = describeApiFailure(result, 'Alert ack');
        return;
      }

      alertWorkflowStatus.textContent = 'Alert acknowledged: ' + alertId;
      await Promise.all([refreshAlerts(), refreshAlertSummary(), refreshAuditLogs()]);
    }

    async function resolveAlert() {
      const alertId = getSelectedAlertId();
      if (!alertId) {
        alertWorkflowStatus.textContent = 'Alert ID is required';
        return;
      }

      alertWorkflowStatus.textContent = 'Sending resolve for ' + alertId + '...';
      const payload = {
        note: String(alertResolveNote.value || '').trim() || undefined,
      };
      const result = await submitJsonMaybe('/api/alerts/' + encodeURIComponent(alertId) + '/resolve', 'POST', payload);
      if (!result.ok) {
        alertWorkflowStatus.textContent = describeApiFailure(result, 'Alert resolve');
        return;
      }

      alertWorkflowStatus.textContent = 'Alert resolved: ' + alertId;
      await Promise.all([refreshAlerts(), refreshAlertSummary(), refreshAuditLogs()]);
    }

    function getIncidentId() {
      return String(incidentIdInput.value || '').trim();
    }

    function getIncidentSourceAlertId() {
      const fromInput = String(incidentSourceAlertId.value || '').trim();
      if (fromInput) {
        return fromInput;
      }
      return getSelectedAlertId();
    }

    async function createIncident() {
      const alertId = getIncidentSourceAlertId();
      const title = String(incidentTitleInput.value || '').trim();
      const severity = String(incidentSeverityInput.value || 'warning').trim() || 'warning';
      const note = String(incidentNoteInput.value || '').trim();
      if (!title) {
        incidentWorkflowStatus.textContent = 'Incident title is required';
        return;
      }

      incidentWorkflowStatus.textContent = 'Creating incident...';
      const result = await submitJsonMaybe('/api/incidents', 'POST', {
        alertId: alertId || undefined,
        title,
        severity,
        site: String(incidentSiteInput.value || '').trim() || undefined,
        owner: String(incidentOwnerInput.value || '').trim() || undefined,
        note: note || undefined,
      });
      if (!result.ok) {
        incidentWorkflowStatus.textContent = describeApiFailure(result, 'Incident create');
        return;
      }

      const created = unwrapPayload(result.payload);
      if (created && typeof created === 'object') {
        loadIncidentIntoForm(created);
      }
      incidentWorkflowStatus.textContent = 'Incident created';
      await Promise.all([refreshIncidents(), refreshIncidentSummary(), refreshIncidentTimeline(), refreshAuditLogs()]);
    }

    async function assignIncident() {
      const incidentId = getIncidentId();
      const owner = String(incidentOwnerInput.value || '').trim();
      if (!incidentId) {
        incidentWorkflowStatus.textContent = 'Incident ID is required';
        return;
      }
      if (!owner) {
        incidentWorkflowStatus.textContent = 'Owner is required';
        return;
      }

      incidentWorkflowStatus.textContent = 'Assigning incident ' + incidentId + '...';
      const result = await submitJsonMaybe('/api/incidents/' + encodeURIComponent(incidentId) + '/assign', 'PUT', {
        owner,
        note: String(incidentNoteInput.value || '').trim() || undefined,
      });
      if (!result.ok) {
        incidentWorkflowStatus.textContent = describeApiFailure(result, 'Incident assign');
        return;
      }

      const updated = unwrapPayload(result.payload);
      if (updated && typeof updated === 'object') {
        loadIncidentIntoForm(updated);
      }
      incidentWorkflowStatus.textContent = 'Incident assigned';
      await Promise.all([refreshIncidents(), refreshIncidentSummary(), refreshIncidentTimeline(), refreshAuditLogs()]);
    }

    async function addIncidentNote() {
      const incidentId = getIncidentId();
      const note = String(incidentNoteInput.value || '').trim();
      if (!incidentId) {
        incidentWorkflowStatus.textContent = 'Incident ID is required';
        return;
      }
      if (!note) {
        incidentWorkflowStatus.textContent = 'Incident note is required';
        return;
      }

      incidentWorkflowStatus.textContent = 'Adding note to incident ' + incidentId + '...';
      const result = await submitJsonMaybe('/api/incidents/' + encodeURIComponent(incidentId) + '/notes', 'POST', {
        note,
      });
      if (!result.ok) {
        incidentWorkflowStatus.textContent = describeApiFailure(result, 'Incident note');
        return;
      }

      const updated = unwrapPayload(result.payload);
      if (updated && typeof updated === 'object') {
        loadIncidentIntoForm(updated);
      }
      incidentWorkflowStatus.textContent = 'Incident note added';
      await Promise.all([refreshIncidents(), refreshIncidentSummary(), refreshIncidentTimeline(), refreshAuditLogs()]);
    }

    async function resolveIncident() {
      const incidentId = getIncidentId();
      const note = String(incidentNoteInput.value || '').trim();
      if (!incidentId) {
        incidentWorkflowStatus.textContent = 'Incident ID is required';
        return;
      }
      if (!note) {
        incidentWorkflowStatus.textContent = 'Resolution note is required';
        return;
      }

      incidentWorkflowStatus.textContent = 'Resolving incident ' + incidentId + '...';
      const result = await submitJsonMaybe('/api/incidents/' + encodeURIComponent(incidentId) + '/resolve', 'POST', {
        note,
      });
      if (!result.ok) {
        incidentWorkflowStatus.textContent = describeApiFailure(result, 'Incident resolve');
        return;
      }

      const updated = unwrapPayload(result.payload);
      if (updated && typeof updated === 'object') {
        loadIncidentIntoForm(updated);
      }
      incidentWorkflowStatus.textContent = 'Incident resolved';
      await Promise.all([refreshIncidents(), refreshIncidentSummary(), refreshIncidentTimeline(), refreshAuditLogs()]);
    }

    async function closeIncident() {
      const incidentId = getIncidentId();
      const note = String(incidentNoteInput.value || '').trim();
      if (!incidentId) {
        incidentWorkflowStatus.textContent = 'Incident ID is required';
        return;
      }
      if (!note) {
        incidentWorkflowStatus.textContent = 'Close note is required';
        return;
      }

      incidentWorkflowStatus.textContent = 'Closing incident ' + incidentId + '...';
      const result = await submitJsonMaybe('/api/incidents/' + encodeURIComponent(incidentId) + '/close', 'POST', {
        note,
      });
      if (!result.ok) {
        incidentWorkflowStatus.textContent = describeApiFailure(result, 'Incident close');
        return;
      }

      const updated = unwrapPayload(result.payload);
      if (updated && typeof updated === 'object') {
        loadIncidentIntoForm(updated);
      }
      incidentWorkflowStatus.textContent = 'Incident closed';
      await Promise.all([refreshIncidents(), refreshIncidentSummary(), refreshIncidentTimeline(), refreshAuditLogs()]);
    }

    async function refreshAuditLogs() {
      if (!canViewAuditLogs()) {
        state.auditLogs = [];
        auditLogCount.textContent = '0 logs';
        auditLogList.replaceChildren(makeEmpty('Audit logs require admin role.'));
        return;
      }
      const params = new URLSearchParams();
      const deviceId = auditDeviceId.value.trim();
      const commandId = auditCommandId.value.trim();
      const limit = Number(auditLimit.value) || 25;

      if (deviceId) params.set('deviceId', deviceId);
      if (commandId) params.set('commandId', commandId);
      params.set('limit', String(Math.min(Math.max(limit, 1), 200)));

      const payload = await fetchJsonMaybe('/api/audit-logs?' + params.toString());
      if (!payload) {
        state.auditLogs = [];
        auditLogCount.textContent = '0 logs';
        auditLogList.replaceChildren(makeEmpty(getAuthFailureHint('Audit log API') || 'Audit log API unavailable or returned no data.'));
        return;
      }

      state.auditLogs = normalizeArray(payload);
      renderAuditLogs();
    }

    function makeEmpty(text) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = text;
      return empty;
    }

    function syncAlertFromSocket(message) {
      const payload = unwrapPayload(message);
      const alerts = Array.isArray(payload) ? payload : [payload];
      alerts.forEach((alert) => {
        if (!alert || typeof alert !== 'object') {
          return;
        }
        const bucket = classifyAlert(alert);
        if (bucket === 'active') {
          replaceAlertInBucket('activeAlerts', alert);
          removeAlertFromBucket('historyAlerts', alert);
        } else {
          replaceAlertInBucket('historyAlerts', alert);
          removeAlertFromBucket('activeAlerts', alert);
        }
        renderAlertStreamLine(alert, 'socket');
      });
      renderAlertPanels();
    }

    function setConnectionState(connected, label, level) {
      statusDot.classList.remove('ok', 'warn', 'danger');
      if (level) {
        statusDot.classList.add(level);
      }
      statusText.textContent = label;
    }

    let socket = null;

    function attachSocket() {
      if (typeof window.io !== 'function') {
        setConnectionState(false, 'Socket client unavailable', 'danger');
        alertSocketState.textContent = 'Unavailable';
        alertStreamSource.textContent = 'none';
        return;
      }

      socket = window.io(location.origin, {
        transports: ['websocket', 'polling'],
        auth: {
          clientType: 'dashboard',
          role: normalizeRole(state.auth.role),
          token: String(state.auth.token || ''),
        },
      });

      socket.on('connect', () => {
        setConnectionState(true, 'Connected', 'ok');
        socketIdEl.textContent = socket.id;
        alertSocketState.textContent = 'Connected';
        refreshDevices();
        refreshAlerts();
        refreshAlertSummary();
        refreshIncidents();
        refreshIncidentSummary();
        refreshIncidentTimeline();
        refreshAuditLogs();
      });

      socket.on('disconnect', () => {
        setConnectionState(false, 'Disconnected', 'warn');
        socketIdEl.textContent = '-';
        alertSocketState.textContent = 'Disconnected';
      });

      socket.on('telemetry', (message) => {
        renderTelemetry(message);
      });

      socket.on('alert', (message) => {
        syncAlertFromSocket(message);
      });

      socket.on('device:metadata', (message) => {
        syncDeviceMetadataFromSocket(message);
      });

      socket.on('device:heartbeat', (message) => {
        syncDeviceHeartbeatFromSocket(message);
      });
    }

    authRole.addEventListener('change', () => {
      applyAuthState(authRole.value, authToken.value);
    });

    authToken.addEventListener('change', () => {
      applyAuthState(authRole.value, authToken.value);
    });

    applyAuthBtn.addEventListener('click', () => {
      applyAuthState(authRole.value, authToken.value);
      void Promise.all([
        refreshDevices(),
        refreshOpsDashboard(),
        refreshTelemetryHistory(),
        refreshAlerts(),
        refreshAlertSummary(),
        refreshIncidents(),
        refreshIncidentSummary(),
        refreshIncidentTimeline(),
        refreshAuditLogs(),
      ]);
    });

    clearAuthBtn.addEventListener('click', () => {
      authToken.value = '';
      applyAuthState(authRole.value, '');
      void Promise.all([
        refreshDevices(),
        refreshOpsDashboard(),
        refreshTelemetryHistory(),
        refreshAlerts(),
        refreshAlertSummary(),
        refreshIncidents(),
        refreshIncidentSummary(),
        refreshIncidentTimeline(),
        refreshAuditLogs(),
      ]);
    });

    sendCmdBtn.addEventListener('click', async () => {
      if (!canSendCommand()) {
        commandStatus.textContent = 'Operator or admin role required to send commands';
        return;
      }

      const deviceId = document.getElementById('deviceId').value.trim();
      const type = document.getElementById('commandType').value;
      const payloadText = document.getElementById('payloadJson').value.trim();

      if (!deviceId) {
        commandStatus.textContent = 'Device ID is required';
        return;
      }

      let payload = {};
      if (payloadText) {
        try {
          payload = JSON.parse(payloadText);
        } catch (err) {
          commandStatus.textContent = 'Payload JSON invalid';
          return;
        }
      }

      const response = await requestJson('/api/devices/' + encodeURIComponent(deviceId) + '/commands', {
        method: 'POST',
        body: { type, payload },
      });
      if (!response.ok) {
        if (response.status === 401) {
          commandStatus.textContent = 'Send failed: unauthorized (401)';
        } else if (response.status === 403) {
          commandStatus.textContent = 'Send failed: forbidden (403)';
        } else {
          commandStatus.textContent = 'Send failed: ' + safeString(response.payload && (response.payload.error || response.status));
        }
        return;
      }

      const data = response.payload;
      if (!data || !data.ok) {
        commandStatus.textContent = 'Send failed: ' + safeString((data && data.error) || response.status);
        return;
      }
      commandStatus.textContent = 'Command sent: ' + (data.data && data.data.commandId ? data.data.commandId : 'ok');
      refreshDevices();
    });

    saveRuleBtn.addEventListener('click', async () => {
      if (!canEditRules()) {
        ruleEditorStatus.textContent = 'Admin role required to create or update rules';
        return;
      }

      const ruleId = ruleIdInput.value.trim();
      const name = ruleNameInput.value.trim();
      const threshold = Number(ruleThresholdInput.value);
      const debounceCount = Number(ruleDebounceInput.value);
      const cooldownMs = Number(ruleCooldownInput.value);

      if (!name) {
        ruleEditorStatus.textContent = 'Rule name is required';
        return;
      }

      if (!Number.isFinite(threshold)) {
        ruleEditorStatus.textContent = 'Threshold must be a valid number';
        return;
      }

      const body = {
        name,
        metric: ruleMetricInput.value,
        severity: ruleSeverityInput.value,
        threshold,
        debounceCount: Number.isFinite(debounceCount) && debounceCount > 0 ? debounceCount : undefined,
        cooldownMs: Number.isFinite(cooldownMs) && cooldownMs >= 0 ? cooldownMs : undefined,
        enabled: ruleEnabledInput.value === 'true',
      };

      ruleEditorStatus.textContent = ruleId ? 'Updating rule...' : 'Creating rule...';
      const result = await submitJsonMaybe(
        ruleId ? '/api/alert-rules/' + encodeURIComponent(ruleId) : '/api/alert-rules',
        ruleId ? 'PUT' : 'POST',
        body,
      );

      if (!result.ok) {
        if (result.status === 401) {
          ruleEditorStatus.textContent = 'Rule save failed: unauthorized (401)';
        } else if (result.status === 403) {
          ruleEditorStatus.textContent = 'Rule save failed: forbidden (403)';
        } else {
          ruleEditorStatus.textContent = 'Rule save failed: ' + safeString(result.payload && (result.payload.error || result.status));
        }
        return;
      }

      ruleEditorStatus.textContent = ruleId ? 'Rule updated' : 'Rule created';
      if (!ruleId) {
        ruleIdInput.value = '';
      }
      refreshAlerts();
      refreshAlertSummary();
    });

    setInterval(refreshDevices, 5000);
    setInterval(refreshAlerts, 12000);
    setInterval(refreshAlertSummary, 15000);
    setInterval(refreshIncidents, 15000);
    setInterval(refreshIncidentSummary, 20000);
    setInterval(refreshIncidentTimeline, 20000);
    setInterval(refreshAuditLogs, 20000);
    setInterval(refreshOpsDashboard, 15000);

    syncAuthUi();
    renderFleetGroups();
    renderFleetPreview();
    renderFleetBatchResult();
    refreshDevices();
    refreshOpsDashboard();
    refreshTelemetryHistory();
    refreshAlerts();
    refreshAlertSummary();
    refreshIncidents();
    refreshIncidentSummary();
    refreshIncidentTimeline();
    refreshAuditLogs();
    attachSocket();
    alertUseFirstBtn.addEventListener('click', () => {
      const first = state.activeAlerts[0];
      const alertId = first && (first.alertId || first.id || first.alert_id);
      if (!alertId) {
        alertWorkflowStatus.textContent = 'No active alert available';
        return;
      }
      seedWorkflowAlertId(alertId);
      alertWorkflowStatus.textContent = 'Loaded alert ' + String(alertId);
    });
    alertAckBtn.addEventListener('click', () => {
      void acknowledgeAlert();
    });
    alertResolveBtn.addEventListener('click', () => {
      void resolveAlert();
    });
    refreshIncidentsBtn.addEventListener('click', () => {
      void refreshIncidents();
      void refreshIncidentSummary();
      void refreshIncidentTimeline();
    });
    refreshAlertSummaryBtn.addEventListener('click', () => {
      void refreshAlertSummary();
    });
    incidentUseAlertBtn.addEventListener('click', () => {
      const alertId = getSelectedAlertId();
      if (!alertId) {
        incidentWorkflowStatus.textContent = 'No active alert available';
        return;
      }
      incidentSourceAlertId.value = alertId;
      incidentWorkflowStatus.textContent = 'Using alert ' + alertId;
    });
    createIncidentBtn.addEventListener('click', () => {
      void createIncident();
    });
    assignIncidentBtn.addEventListener('click', () => {
      void assignIncident();
    });
    incidentNoteBtn.addEventListener('click', () => {
      void addIncidentNote();
    });
    resolveIncidentBtn.addEventListener('click', () => {
      void resolveIncident();
    });
    closeIncidentBtn.addEventListener('click', () => {
      void closeIncident();
    });
    incidentStatusFilter.addEventListener('change', () => {
      void refreshIncidents();
      void refreshIncidentSummary();
    });
    incidentSeverityFilter.addEventListener('change', () => {
      void refreshIncidents();
      void refreshIncidentSummary();
    });
    incidentOwnerFilter.addEventListener('change', () => {
      void refreshIncidents();
      void refreshIncidentSummary();
    });
    incidentSiteFilter.addEventListener('change', () => {
      void refreshIncidents();
      void refreshIncidentSummary();
    });
    incidentFromFilter.addEventListener('change', () => {
      void refreshIncidents();
      void refreshIncidentSummary();
    });
    incidentToFilter.addEventListener('change', () => {
      void refreshIncidents();
      void refreshIncidentSummary();
    });
    refreshIncidentSummaryBtn.addEventListener('click', () => {
      void refreshIncidentSummary();
    });
    refreshIncidentTimelineBtn.addEventListener('click', () => {
      void refreshIncidentTimeline();
    });
    runHandoverBtn.addEventListener('click', () => {
      void runShiftHandoverSnapshot();
    });
    fleetSaveGroupBtn.addEventListener('click', saveFleetPreset);
    fleetPreviewBtn.addEventListener('click', () => {
      void previewFleetDevices();
    });
    fleetDryRunBtn.addEventListener('click', () => {
      void runFleetDryRun();
    });
    fleetApplyBtn.addEventListener('click', () => {
      void applyFleetConfig();
    });
    refreshAuditLogsBtn.addEventListener('click', refreshAuditLogs);
    refreshOpsBtn.addEventListener('click', refreshOpsDashboard);
    refreshTelemetryHistoryBtn.addEventListener('click', refreshTelemetryHistory);
  </script>
</body>
</html>`;
}
